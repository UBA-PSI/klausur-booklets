const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

function parseTemplate(template, submittedSeiten, missingSeiten) {
    return template
        .replace('{{submittedSeiten}}', submittedSeiten.join(', '))
        .replace('{{missingSeiten}}', missingSeiten.join(', '));
}

async function generateCoverSheet(template, submittedSeiten, missingSeiten, studentName) {
    const content = parseTemplate(template, submittedSeiten, missingSeiten);

    const pdfDoc = await PDFDocument.create();
    // const page = pdfDoc.addPage([600, 400]);
	const page = pdfDoc.addPage([595.28, 841.89]);

    // Add student's name prominently at the top
    page.drawText(studentName, {
        x: 50,
        y: 375,  // Adjust this value to position the name appropriately
        size: 18,
        bold: true
    });

    // Render the rest of the content below the student's name
    page.drawText(content, {
        x: 50,
        y: 350,
        size: 14
    });

    return pdfDoc;
}

async function mergeStudentPDFs(mainDirectory) {
    const studentPDFs = {};
    const missingSubmissions = {};

    const seiteFolders = fs.readdirSync(mainDirectory).filter(dir => dir.startsWith('Seite')).sort();

    // 1. Initialization: Assume all students are missing all submissions
    for (const seiteFolder of seiteFolders) {
        const seitePath = path.join(mainDirectory, seiteFolder);
        const studentFolders = fs.readdirSync(seitePath).filter(item => {
            const itemPath = path.join(seitePath, item);
            return fs.statSync(itemPath).isDirectory();
        });

        for (const studentFolder of studentFolders) {
            const studentName = studentFolder.split('_')[0];
            if (!missingSubmissions[studentName]) {
                missingSubmissions[studentName] = [...seiteFolders];  // Clone the seiteFolders array
            }
        }
    }

    // 2. During Processing: Remove submissions found from the missing list
    for (const seiteFolder of seiteFolders) {
        const seitePath = path.join(mainDirectory, seiteFolder);
        const studentFolders = fs.readdirSync(seitePath).filter(item => {
            const itemPath = path.join(seitePath, item);
            return fs.statSync(itemPath).isDirectory();
        });

        for (const studentFolder of studentFolders) {
            const studentName = studentFolder.split('_')[0];
            const studentFolderPath = path.join(seitePath, studentFolder);

            const pdfFile = fs.readdirSync(studentFolderPath).find(file => file.endsWith('.pdf'));

            if (pdfFile) {
                const pdfBuffer = fs.readFileSync(path.join(studentFolderPath, pdfFile));
                const pdfDoc = await PDFDocument.load(pdfBuffer);

                const studentMergedPDF = studentPDFs[studentName] || await PDFDocument.create();
                studentPDFs[studentName] = studentMergedPDF;

                const [page] = await studentMergedPDF.copyPages(pdfDoc, [0]);
                studentMergedPDF.addPage(page);

                // Remove the seiteFolder from the missing submissions for this student
                const index = missingSubmissions[studentName].indexOf(seiteFolder);
                if (index > -1) {
                    missingSubmissions[studentName].splice(index, 1);
                }
            }
        }
    }

    // ... (Post-Processing)

    const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
    const template = fs.readFileSync(config.descriptionFilePath, 'utf-8');

    for (const [studentName, mergedPdf] of Object.entries(studentPDFs)) {
        const submittedSeiten = seiteFolders.filter(seite => !missingSubmissions[studentName] || !missingSubmissions[studentName].includes(seite));
        const missingSeiten = missingSubmissions[studentName] || [];

        const coverSheet = await generateCoverSheet(template, submittedSeiten, missingSeiten, studentName);

        const [coverPage] = await mergedPdf.copyPages(coverSheet, [0]);
        mergedPdf.insertPage(0, coverPage);

        const outputFileName = `${studentName.replace(' ', '-')}.pdf`;
        const outputPath = path.join(mainDirectory, outputFileName);
        fs.writeFileSync(outputPath, await mergedPdf.save());
    }
}



async function convertToBooklet(pdfPath) {
    const originalPdf = await PDFDocument.load(fs.readFileSync(pdfPath));
    const bookletPdf = await PDFDocument.create();

    let pageCount = originalPdf.getPageCount();

    // 1. Determine the number of padding pages
    const remainder = pageCount % 4;
    const paddingPages = remainder ? (4 - remainder) : 0;

    // 2. Add blank pages if necessary
    for (let i = 0; i < paddingPages; i++) {
        originalPdf.addPage([originalPdf.getPages()[0].getWidth(), originalPdf.getPages()[0].getHeight()]);
    }

    pageCount += paddingPages; // Update the page count
    console.log("pageCount: "+pageCount);
	
	const firstPage = originalPdf.getPages()[0];
	const width = firstPage ? firstPage.getWidth() : null;
	const height = firstPage ? firstPage.getHeight() : null;

	if (!width || !height) {
	    throw new Error(`Unable to fetch dimensions for the first page of the PDF at ${pdfPath}.`);
	}
	
	const pages = originalPdf.getPages();
	console.log(`Total pages in originalPdf: ${pages.length}`);

	pages.forEach((page, index) => {
	    try {
	        const { width, height } = page.getSize();
	        console.log(`Page index: ${index}, Width: ${width}, Height: ${height}`);
	    } catch (error) {
	        console.error(`Error retrieving details for page index ${index}: ${error.message}`);
	    }
	});
	
	
	
    const scaledWidth = width / 2;
    for (let i = 0; i < pageCount / 2; i++) {
        const frontLeft = pageCount - i - 1;
        const frontRight = i;
        const backLeft = i + 1;
        const backRight = pageCount - i - 2;
		console.log("frontLeft: "+frontLeft);
		
        const [frontLeftPage] = await bookletPdf.copyPages(originalPdf, [frontLeft]);
        const [frontRightPage] = await bookletPdf.copyPages(originalPdf, [frontRight]);
        const [backLeftPage] = await bookletPdf.copyPages(originalPdf, [backLeft]);
        const [backRightPage] = await bookletPdf.copyPages(originalPdf, [backRight]);
       console.log("aaa");
        const front = bookletPdf.addPage([height, width]);
		       console.log("aaa1");
		   
		   front.drawPage(frontLeftPage, {
		       x: 0,
		       y: 0,
		       width: scaledWidth,
		       height: height
		   });
        
		       console.log("aaa2");
        front.drawPage(frontRightPage, { x: scaledWidth, width: scaledWidth });
       console.log("aaaa");
        const back = bookletPdf.addPage([height, width]);
        back.drawPage(backLeftPage, { x: 0, width: scaledWidth });
        back.drawPage(backRightPage, { x: scaledWidth, width: scaledWidth });
    }

    return bookletPdf;
}



module.exports = {
    mergeStudentPDFs,
	convertToBooklet
};
