const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { execSync } = require('child_process');
const { renderFirstPageToImage, imageToPdf } = require('./pdf-cmdline-processor');

function parseTemplate(template, submittedSeiten, missingSeiten) {
    return template
        .replace('{{submittedSeiten}}', submittedSeiten.join("\n"))
        .replace('{{missingSeiten}}', missingSeiten.join("\n"));
}

async function generateCoverSheet(template, submittedSeiten, missingSeiten, studentName, width, height) {
    const content = parseTemplate(template, submittedSeiten, missingSeiten);

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([width, height]);

    // Add student's name prominently at the top
    page.drawText(studentName, {
        x: 50,
        y: height - 35,  // Adjust this value to position the name appropriately
        size: 18,
        bold: true
    });

    // Render the rest of the content below the student's name
    page.drawText(content, {
        x: 50,
        y: height - 70,  // Adjust this value to position the content appropriately
        size: 10
    });

    return pdfDoc;
}



async function mergeStudentPDFs(mainDirectory, outputDirectory, descriptionFilePath) {
    const pdfsSubDirectory = path.join(outputDirectory, 'pdfs');
    if (!fs.existsSync(pdfsSubDirectory)) {
        fs.mkdirSync(pdfsSubDirectory);
    }

    const studentDirectories = fs.readdirSync(outputDirectory).filter(
        dir => dir !== 'pdfs' && dir !== 'booklets' &&
        fs.statSync(path.join(outputDirectory, dir)).isDirectory()).sort();

    const template = fs.readFileSync(descriptionFilePath, 'utf-8');

    for (const studentName of studentDirectories) {
        const studentDirPath = path.join(outputDirectory, studentName);
        if (!fs.statSync(studentDirPath).isDirectory()) {
            continue; // Skip if not a directory
        }

        const studentPDFs = fs.readdirSync(studentDirPath).filter(file => file.endsWith('.pdf')).sort();

        if (studentPDFs.length === 0) {
            continue; // Skip if no PDFs found
        }

        const mergedPdf = await PDFDocument.create();
        const submittedSeiten = [];

        let dimensionsDetermined = false;
        let width = 595.28;  // Default A4 width
        let height = 841.89;  // Default A4 height

        for (const pdfFile of studentPDFs) {
            const pdfBuffer = fs.readFileSync(path.join(studentDirPath, pdfFile));
            const pdfDoc = await PDFDocument.load(pdfBuffer);

            // If dimensions are not determined yet, determine from the first PDF
            if (!dimensionsDetermined) {
                const [firstPage] = pdfDoc.getPages();
                width = firstPage.getWidth();
                height = firstPage.getHeight();
                dimensionsDetermined = true;
            }

            const [page] = await mergedPdf.copyPages(pdfDoc, [0]);
            mergedPdf.addPage(page);

            // Add to submittedSeiten list
            const seiteName = path.basename(pdfFile, '.pdf');
            submittedSeiten.push(seiteName);
        }

        if (!dimensionsDetermined) {
            console.warn(`No available PDF found for student ${studentName}. Using default A4 dimensions.`);
        }

        // Generate the cover sheet
	    const seiteFolders = fs.readdirSync(mainDirectory).filter(item => {
	        const itemPath = path.join(mainDirectory, item);
	        return fs.statSync(itemPath).isDirectory();
	    });
        const missingSeiten = seiteFolders.filter(seite => !submittedSeiten.includes(seite));
        const coverSheet = await generateCoverSheet(template, submittedSeiten, missingSeiten, studentName, width, height);
        const [coverPage] = await mergedPdf.copyPages(coverSheet, [0]);
        mergedPdf.insertPage(0, coverPage);

        const outputPath = path.join(pdfsSubDirectory, `${studentName}.pdf`);
        fs.writeFileSync(outputPath, await mergedPdf.save());
    }
}




async function transformAndMergeStudentPDFs(mainDirectory, outputDirectory, descriptionFilePath, dpiValue) {
    const subdirectories = fs.readdirSync(mainDirectory).filter(item => {
        const itemPath = path.join(mainDirectory, item);
        return fs.statSync(itemPath).isDirectory();
    });

    for (const subdir of subdirectories) {
        const subdirPath = path.join(mainDirectory, subdir);
        const studentFolders = fs.readdirSync(subdirPath).filter(item => {
            const itemPath = path.join(subdirPath, item);
            return fs.statSync(itemPath).isDirectory();
        });

        const nameCounts = {};
        for (const studentFolder of studentFolders) {
            const studentName = studentFolder.split('_')[0];
            nameCounts[studentName] = (nameCounts[studentName] || 0) + 1;
        }

        const duplicates = Object.keys(nameCounts).filter(name => nameCounts[name] > 1);
        if (duplicates.length > 0) {
            throw new Error('Name collision detected in directory ' + subdir + ' for the following student(s): ' + duplicates.join(', '));
        }

        for (const studentFolder of studentFolders) {
            const studentName = studentFolder.split('_')[0];
            const studentFolderPath = path.join(subdirPath, studentFolder);

            const pdfFile = fs.readdirSync(studentFolderPath).find(file => file.endsWith('.pdf'));
            if (pdfFile) {
                const inputPdfPath = path.join(studentFolderPath, pdfFile);
                const transformedPdfPath = path.join(outputDirectory, studentName, subdir + '.pdf');  // Using the current subdir's name

                // Check if directory exists, if not, create it
                const studentOutputDirectory = path.join(outputDirectory, studentName);
                if (!fs.existsSync(studentOutputDirectory)){
                    fs.mkdirSync(studentOutputDirectory);
                }

                try {
                    // Use the JavaScript-based PDF processor
                    console.log(`Processing ${inputPdfPath} with DPI ${dpiValue}...`);
                    
                    // Render first page to image
                    const imageBuffer = await renderFirstPageToImage(inputPdfPath, dpiValue);
                    
                    // Convert image to PDF
                    await imageToPdf(imageBuffer, transformedPdfPath);
                    
                    console.log(`Successfully created ${transformedPdfPath}`);
                } catch (error) {
                    console.error(`Error processing PDF ${inputPdfPath}:`, error);
                }
            }
        }
    }
}



module.exports = {
    mergeStudentPDFs,
	transformAndMergeStudentPDFs
};
