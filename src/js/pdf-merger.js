const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFPage } = require('pdf-lib');
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

/**
 * Creates a saddle-stitched booklet PDF from an input PDF.
 * Reorders pages and adds blank pages if necessary to make the page count a multiple of 4.
 * @param {string} inputPath - Path to the input PDF file.
 * @param {string} outputPath - Path to save the output booklet PDF.
 */
async function createSaddleStitchBooklet(inputPath, outputPath) {
    // console.log(`[Booklet] Starting creation for ${inputPath} -> ${outputPath}`); // Removed log
    const pdfBytes = fs.readFileSync(inputPath);
    const inputDoc = await PDFDocument.load(pdfBytes);
    const pageCount = inputDoc.getPageCount();
    // console.log(`[Booklet] Original page count: ${pageCount}`); // Removed log

    if (pageCount === 0) {
        console.warn(`Skipping booklet creation for empty PDF: ${inputPath}`);
        return; // Skip if the PDF has no pages
    }

    let finalPageCount = pageCount;
    const pagesToAdd = (4 - (pageCount % 4)) % 4;
    finalPageCount += pagesToAdd;
    // console.log(`[Booklet] Final page count (multiple of 4): ${finalPageCount}`); // Removed log

    const newPdfDoc = await PDFDocument.create();
    const newIndices = [];

    // Calculate new page order for saddle stitch
    for (let i = 0; i < finalPageCount / 2; i++) {
        if (i % 2 === 0) { // Outer sheet: Last, First, Second, Second-to-Last, ...
            newIndices.push(finalPageCount - 1 - i);
            newIndices.push(i);
        } else { // Inner sheet: Third, Third-to-Last, Fourth, Fourth-to-Last, ...
            newIndices.push(i);
            newIndices.push(finalPageCount - 1 - i);
        }
    }
    // console.log(`[Booklet] Calculated new page index order: ${JSON.stringify(newIndices)}`); // Removed log

    // Get dimensions from the first page
    const [firstInputPage] = inputDoc.getPages();
    const inputWidth = firstInputPage.getWidth();
    const inputHeight = firstInputPage.getHeight();

    // Determine output page size (e.g., landscape A3 for portrait A4 input)
    const outputPageWidth = inputWidth * 2;
    const outputPageHeight = inputHeight;
    // console.log(`[Booklet] Input Page Size: ${inputWidth}x${inputHeight}`); // Removed log
    // console.log(`[Booklet] Output Page Size (2-up): ${outputPageWidth}x${outputPageHeight}`); // Removed log

    // --- Logic using embedPage --- 
    // 1. Pre-embed all necessary pages
    const embeddedPages = new Map(); 
    // console.log(`[Booklet] Embedding ${pageCount} source pages...`); // Removed log
    for (let i = 0; i < pageCount; i++) {
        const [embeddedPage] = await newPdfDoc.embedPdf(inputDoc, [i]); 
        embeddedPages.set(i, embeddedPage);
    }
    // console.log(`[Booklet] Finished embedding source pages.`); // Removed log

    // 2. Iterate through the required OUTPUT pages
    for (let i = 0; i < finalPageCount / 2; i++) {
        const leftSourceIndex = newIndices[i * 2];
        const rightSourceIndex = newIndices[i * 2 + 1];

        const outputPage = newPdfDoc.addPage([outputPageWidth, outputPageHeight]);
        // console.log(`[Booklet] Created output page ${i + 1}`); // Removed log

        // --- Draw Left Page ---
        if (leftSourceIndex < pageCount) {
            const leftPageToDraw = embeddedPages.get(leftSourceIndex);
            if (leftPageToDraw) {
                 try {
                    // console.log(`[Booklet] Attempting to draw pre-embedded source index ${leftSourceIndex} onto left side`); // Removed log
                    outputPage.drawPage(leftPageToDraw, {
                        x: 0,
                        y: 0,
                        width: inputWidth,
                        height: inputHeight
                    });
                    // console.log(`[Booklet] Drew source index ${leftSourceIndex} onto left side`); // Removed log
                 } catch (drawError) {
                     console.error(`[Booklet] Error drawing left page (source index ${leftSourceIndex}) on output page ${i + 1}:`, drawError);
                     throw drawError; 
                 }
            } else {
                 console.error(`[Booklet] Critical Error: Failed to find pre-embedded page for source index ${leftSourceIndex}`);
                 throw new Error(`Failed to find pre-embedded page for source index ${leftSourceIndex}`);
            }
        } else {
            // console.log(`[Booklet] Left side of output page ${i + 1} is blank (source index ${leftSourceIndex} was padding).`); // Removed log
        }

        // --- Draw Right Page ---
        if (rightSourceIndex < pageCount) {
            const rightPageToDraw = embeddedPages.get(rightSourceIndex);
             if (rightPageToDraw) {
                try {
                    // console.log(`[Booklet] Attempting to draw pre-embedded source index ${rightSourceIndex} onto right side`); // Removed log
                    outputPage.drawPage(rightPageToDraw, {
                        x: inputWidth,
                        y: 0,
                        width: inputWidth,
                        height: inputHeight
                    });
                    // console.log(`[Booklet] Drew source index ${rightSourceIndex} onto right side`); // Removed log
                 } catch (drawError) {
                    console.error(`[Booklet] Error drawing right page (source index ${rightSourceIndex}) on output page ${i + 1}:`, drawError);
                    throw drawError; 
                 }
             } else {
                 console.error(`[Booklet] Critical Error: Failed to find pre-embedded page for source index ${rightSourceIndex}`);
                 throw new Error(`Failed to find pre-embedded page for source index ${rightSourceIndex}`);
             }
        } else {
            // console.log(`[Booklet] Right side of output page ${i + 1} is blank (source index ${rightSourceIndex} was padding).`); // Removed log
        }
    }
    // --- End Logic ---

    // Save the new PDF
    const newPdfBytes = await newPdfDoc.save();
    fs.writeFileSync(outputPath, newPdfBytes);
    console.log(`Booklet created: ${outputPath}`); // Keep final success log
}

module.exports = {
    mergeStudentPDFs,
	transformAndMergeStudentPDFs,
    createSaddleStitchBooklet
};
