const muhammara = require('muhammara');
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
    const page = pdfDoc.addPage([595.28, 841.89]);

    // Add student's name prominently at the top
    page.drawText(studentName, {
        x: 50,
        y: 775,  // Adjusted for A4 size
        size: 18,
        bold: true
    });

    // Render the rest of the content below the student's name
    page.drawText(content, {
        x: 50,
        y: 750,
        size: 14
    });

    return pdfDoc;
}

async function validatePDF(pdfDocument) {
    const pages = pdfDocument.getPages();
    if (pages.length === 0) {
        throw new Error("The provided PDF has no pages.");
    }
    pages.forEach((page, index) => {
        if (!page) {
            throw new Error(`Page at index ${index} is null or undefined.`);
        }
        if (typeof page.drawText !== 'function') {
            throw new Error(`Page at index ${index} is invalid.`);
        }
    });
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
    const reader = muhammara.createReader(pdfPath);
    const writer = muhammara.createWriterToModify(pdfPath, { modifiedFilePath: pdfPath.replace('.pdf', '_booklet.pdf') });

    const pageCount = reader.getPagesCount();
    const pagesToAdd = pageCount % 4 === 0 ? 0 : 4 - (pageCount % 4);
    const total = pageCount + pagesToAdd;

    for (let i = 0; i < total / 2; i++) {
        const frontLeft = total - i - 1;
        const frontRight = i;

        if (frontRight < pageCount) {
            try {
                writer.mergePDFPagesToPage(writer.createPage([595, 842 * 2]), reader, {
                    type: muhammara.eRangeTypeSpecific,
                    specificRanges: [[frontRight, frontRight]]
                });
            } catch (err) {
                console.error(`Failed to append page ${frontRight}.`, err);
            }
        }

        if (frontLeft < pageCount) {
            try {
                writer.mergePDFPagesToPage(writer.createPage([595, 842 * 2]), reader, {
                    type: muhammara.eRangeTypeSpecific,
                    specificRanges: [[frontLeft, frontLeft]]
                });
            } catch (err) {
                console.error(`Failed to append page ${frontLeft}.`, err);
            }
        }
    }

    writer.end();
    return pdfPath.replace('.pdf', '_booklet.pdf');
}






module.exports = {
	mergeStudentPDFs,
	convertToBooklet
};
