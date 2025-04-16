const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFPage } = require('pdf-lib');
const { execSync } = require('child_process');
const sharp = require('sharp');
const decodeHeic = require('heic-decode');
const { renderFirstPageToImage, imageToPdf } = require('./pdf-cmdline-processor');

// --- Custom Error for Ambiguity ---
class AmbiguityError extends Error {
    constructor(ambiguities) {
        // ambiguities is expected to be an array of objects: [{ folderPath: string, files: string[] }]
        super("File ambiguity detected");
        this.name = "AmbiguityError";
        this.ambiguities = ambiguities; 
    }
}
// ---------------------------------

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

/**
 * Processes a single input file (PDF, PNG, JPG, HEIC) into an A5 PDF page.
 * @param {string} inputPath Path to the input file.
 * @param {string} outputPath Path to save the resulting single-page PDF.
 * @param {number} dpiValue DPI for PDF rendering (if applicable).
 */
async function processSingleTransformation(inputPath, outputPath, dpiValue) {
    const ext = path.extname(inputPath).toLowerCase(); 
    let imageBufferForPdfLib; // Buffer ready to be embedded (always PNG format)
    let needsRotation = false;

    console.log(`[Transform Single] Starting: Input=${inputPath}, Output=${outputPath}, Ext=${ext}`);

    try {
        let initialBuffer; // Buffer directly from file or rendering

        if (ext === '.pdf') {
            console.log(`[Transform Single] Processing as PDF.`);
            initialBuffer = await renderFirstPageToImage(inputPath, dpiValue); // Renders first page to PNG buffer
        } else if (ext === '.png') {
            console.log(`[Transform Single] Processing as PNG.`);
            initialBuffer = fs.readFileSync(inputPath);
        } else if (ext === '.jpg' || ext === '.jpeg') {
            console.log(`[Transform Single] Processing as JPG/JPEG.`);
            initialBuffer = fs.readFileSync(inputPath);
            // Convert to PNG later if needed (e.g., for rotation check/apply)
        } else if (ext === '.heic') {
            console.log(`[Transform Single] Processing as HEIC.`);
            const heicBuffer = fs.readFileSync(inputPath);
            const { data, width, height } = await decodeHeic({ buffer: heicBuffer });
            console.log(`[Transform Single] Decoded HEIC to raw data (${width}x${height})`);
            // Convert raw to PNG buffer now
            initialBuffer = await sharp(data, {
                raw: {
                    width: width,
                    height: height,
                    channels: 4
                }
            }).png().toBuffer();
            console.log(`[Transform Single] Converted HEIC raw data to PNG buffer.`);
        } else {
            console.warn(`[Transform Single] Skipping unsupported file type: ${inputPath}`);
            return; 
        }

        if (!initialBuffer) {
             console.error(`[Transform Single] Failed to get initial buffer for ${inputPath}`);
             return;
        }

        // Check dimensions and determine rotation need using Sharp
        const metadata = await sharp(initialBuffer).metadata();
        console.log(`[Transform Single] Image dimensions: ${metadata.width}x${metadata.height}`);
        if (metadata.width > metadata.height) {
            console.log(`[Transform Single] Image is landscape (width > height), rotation needed.`);
            needsRotation = true;
        }

        // Prepare the final buffer for pdf-lib (ensure PNG, apply rotation if needed)
        let sharpInstance = sharp(initialBuffer);
        if (needsRotation) {
            sharpInstance = sharpInstance.rotate(90);
        }
        // Ensure output is PNG for pdf-lib's embedPng
        imageBufferForPdfLib = await sharpInstance.png().toBuffer(); 

        // Convert the final image buffer to a PDF page
        if (imageBufferForPdfLib) {
            // Pass the original landscape status to imageToPdf if needed for scaling logic, 
            // although the buffer passed is now rotated to portrait.
            // For simplicity, let imageToPdf determine final scaling based on the buffer it receives.
            await imageToPdf(imageBufferForPdfLib, outputPath); 
            console.log(`[Transform Single] Successfully created PDF page: ${outputPath}`);
        } else {
             console.error(`[Transform Single] Failed to get final image buffer for ${inputPath}`);
        }

    } catch (error) {
        console.error(`[Transform Single] Error processing file ${inputPath}:`, error);
        throw error; 
    }
}

/**
 * Scans input directories, checks for ambiguities, and returns processing info.
 * Returns { tasks: [], ambiguities: [] } where tasks are unambiguous items 
 * and ambiguities lists folders needing resolution.
 * @param {string} mainDirectory 
 * @param {string} outputDirectory 
 * @returns {Promise<{tasks: Array<{inputPath: string, outputPath: string}>, ambiguities: Array<{folderPath: string, context: string, files: string[]}>}>} 
 */
async function prepareTransformations(mainDirectory, outputDirectory) {
    console.log("[Prepare] Scanning input directories...");
    const transformationTasks = []; // Tasks ready to process
    const ambiguities = [];         // Folders needing user input
    const allowedExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.heic'];

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

        // Check for student name collisions (remains important)
        const nameCounts = {};
        for (const studentFolder of studentFolders) {
            const studentName = studentFolder.split('_')[0];
            nameCounts[studentName] = (nameCounts[studentName] || 0) + 1;
        }
        const duplicates = Object.keys(nameCounts).filter(name => nameCounts[name] > 1);
        if (duplicates.length > 0) {
            throw new Error(`Name collision detected in directory ${subdir} for student(s): ${duplicates.join(', ')}`);
        }

        // Find processable files and check for ambiguity
        for (const studentFolder of studentFolders) {
            const studentName = studentFolder.split('_')[0];
            const studentFolderPath = path.join(subdirPath, studentFolder);
            const studentOutputDirectory = path.join(outputDirectory, studentName);

            const processableFiles = fs.readdirSync(studentFolderPath).filter(file => {
                 // Ensure case-insensitive check here too
                 const ext = path.extname(file).toLowerCase(); 
                 return allowedExtensions.includes(ext);
            });

            if (processableFiles.length === 0) {
                console.log(`[Prepare] No processable files found in: ${studentFolderPath}`);
                continue; // Skip folder if no valid files
            } else if (processableFiles.length > 1) {
                console.log(`[Prepare] Ambiguity detected in: ${studentFolderPath} - Files: ${processableFiles.join(', ')}`);
                ambiguities.push({ 
                    folderPath: studentFolderPath, 
                    context: `Student: ${studentName}, Page: ${subdir}`, 
                    files: processableFiles 
                });
            } else {
                // Exactly one file found, add to tasks
                 // Ensure output directory exists
                if (!fs.existsSync(studentOutputDirectory)){
                    console.log(`[Prepare] Creating output directory: ${studentOutputDirectory}`);
                    fs.mkdirSync(studentOutputDirectory, { recursive: true });
                }
                const inputPath = path.join(studentFolderPath, processableFiles[0]);
                const outputPath = path.join(studentOutputDirectory, `${subdir}.pdf`); // Output is always .pdf
                transformationTasks.push({ inputPath, outputPath });
            }
        }
    }

    // Return both unambiguous tasks and ambiguities
    console.log(`[Prepare] Scan complete. Tasks: ${transformationTasks.length}, Ambiguities: ${ambiguities.length}`);
    return { tasks: transformationTasks, ambiguities: ambiguities };
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
    prepareTransformations,
    processSingleTransformation,
    createSaddleStitchBooklet,
    // AmbiguityError // No longer throwing, just returning ambiguities
};
