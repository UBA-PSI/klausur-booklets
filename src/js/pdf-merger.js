const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFPage, StandardFonts, rgb } = require('pdf-lib');
const sharp = require('sharp');
const decodeHeic = require('heic-decode');
const { marked } = require('marked');
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

async function generateCoverSheet(templateContent, submittedSeitenListString, missingSeiten, studentInfo, width, height) {
    if (!templateContent) {
        console.error("Error: No cover sheet template content provided.");
        // Provide a minimal fallback if content is empty or null
        templateContent = `# Error: Template Missing

Student: {{LAST_NAME}}, {{FIRST_NAME}}

**Submitted Pages:**
{{SUBMITTED_PAGES_LIST}}

**Missing Pages:**
{{MISSING_PAGES_LIST}}`;
    }

    // Extract info, providing defaults
    const fullName = studentInfo?.fullName || 'Unknown Name';
    const firstName = studentInfo?.firstName || '';
    const lastName = studentInfo?.lastName || 'Unknown';
    const studentNumber = studentInfo?.studentNumber || '–'; // Use '–' if not available

    // Sort the missing pages list alphabetically
    const sortedMissingSeiten = [...missingSeiten].sort();
    const missingList = sortedMissingSeiten.length > 0 ? sortedMissingSeiten.join('\n') : 'None';

    // Replace template tags
    let processedContent = templateContent
        .replace(/\{\{\s*FULL_NAME\s*\}\}/gi, fullName) 
        .replace(/\{\{\s*LAST_NAME\s*\}\}/gi, lastName)
        .replace(/\{\{\s*FIRST_NAME\s*\}\}/gi, firstName)
        .replace(/\{\{\s*STUDENTNUMBER\s*\}\}/gi, studentNumber) // Replace student number
        .replace(/\{\{\s*SUBMITTED_PAGES_LIST\s*\}\}/gi, submittedSeitenListString) // This will be replaced *after* sorting the list
        .replace(/\{\{\s*MISSING_PAGES_LIST\s*\}\}/gi, missingList);

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([width, height]);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Settings for drawing
    const margin = 50;
    let currentY = height - margin; // Start from top margin
    const lineSpacing = 6;
    const paragraphSpacing = 12;
    const listIndent = 20;
    const baseFontSize = 11;
    const headingFontSize = 18;
    const nameFontSize = 14;
    const labelFontSize = 12;

    // --- Parse and Draw Markdown Template ---
    const tokens = marked.lexer(processedContent);
    
    for (const token of tokens) {
        if (currentY < margin) break; // Stop if we run out of space

        switch (token.type) {
            case 'heading':
                const isBoldHeading = token.text.startsWith('**') && token.text.endsWith('**');
                const headingText = isBoldHeading ? token.text.slice(2, -2) : token.text;
                page.drawText(headingText, {
                    x: margin,
                    y: currentY,
                    font: isBoldHeading ? helveticaBold : helveticaBold, // Keep headings bold for now
                    size: headingFontSize - (token.depth * 2), 
                    lineHeight: (headingFontSize - (token.depth * 2)) + lineSpacing,
                });
                currentY -= (headingFontSize - (token.depth * 2)) + paragraphSpacing;
                break;
            case 'paragraph':
                // More robust paragraph handling (handles **bold** and *italic*)
                const segments = parseTextSegments(token.text, helvetica, helveticaBold, baseFontSize, width - 2 * margin);
                for (const lineSegments of segments) {
                    if (currentY < margin) break;
                    let currentX = margin;
                    for (const seg of lineSegments) {
                        page.drawText(seg.text, {
                            x: currentX,
                            y: currentY,
                            font: seg.font,
                            size: baseFontSize
                        });
                        currentX += seg.width;
                    }
                    currentY -= (baseFontSize + lineSpacing);
                }
                // Add paragraph spacing only if we actually drew something
                if (segments.length > 0) {
                    currentY -= (paragraphSpacing - lineSpacing); 
                }
                break;
            case 'list': 
                 for (const item of token.items) {
                     if (currentY < margin) break;
                     // Draw bullet and then handle text segments like paragraphs
                     page.drawText('-', { x: margin, y: currentY, font: helvetica, size: baseFontSize });
                     const itemSegments = parseTextSegments(item.text, helvetica, helveticaBold, baseFontSize, width - 2 * margin - listIndent);
                     let itemCurrentY = currentY;
                     let firstLine = true;
                     for (const lineSegments of itemSegments) {
                         if (itemCurrentY < margin) break;
                         let currentX = margin + listIndent;
                         for (const seg of lineSegments) {
                            page.drawText(seg.text, {
                                x: currentX,
                                y: itemCurrentY,
                                font: seg.font,
                                size: baseFontSize
                            });
                            currentX += seg.width;
                         }
                         itemCurrentY -= (baseFontSize + lineSpacing);
                         firstLine = false;
                     }
                     currentY = itemCurrentY; // Update main Y position
                 }
                 if (token.items.length > 0) { // Add spacing only if list wasn't empty
                    currentY -= (paragraphSpacing - lineSpacing); 
                 }
                 break;
            case 'space': // Represents blank lines or space between block elements
                currentY -= paragraphSpacing * (token.raw.match(/\n/g)?.length || 1);
                break;
            case 'hr': // Draw a horizontal rule
                 if (currentY >= margin) {
                     currentY -= lineSpacing;
                     page.drawLine({ 
                         start: { x: margin, y: currentY }, 
                         end: { x: width - margin, y: currentY }, 
                         thickness: 1, 
                         color: rgb(0.7, 0.7, 0.7) 
                        });
                     currentY -= paragraphSpacing;
                 }
                break;
            // Add cases for other token types if needed (e.g., blockquote, code)
            default:
                // console.log("Unhandled token type:", token.type);
                break;
        }
    }

    return pdfDoc;
}

// --- Helper Function for Text Segment Parsing (Handles Bold/Italic) ---
function parseTextSegments(text, fontRegular, fontBold, fontSize, maxWidth) {
    // Very basic parser: looks for **bold** and assumes everything else is regular
    // Doesn't handle nesting or complex markdown, but covers the use case.
    const lines = [];
    let currentLineSegments = [];
    let currentLineWidth = 0;

    // Split text potentially containing markdown formatting
    const parts = text.split(/(\*\*.*?\*\*)/g).filter(part => part); // Split by bold markers

    for (const part of parts) {
        const isBold = part.startsWith('**') && part.endsWith('**');
        const segmentText = isBold ? part.slice(2, -2) : part;
        const segmentFont = isBold ? fontBold : fontRegular;
        
        // Process word by word for wrapping
        const words = segmentText.split(/\s+/).filter(w => w);
        for (const word of words) {
            const wordWidth = segmentFont.widthOfTextAtSize(word, fontSize);
            const spaceWidth = fontRegular.widthOfTextAtSize(' ', fontSize); // Use regular font for space width
            const wordWidthWithSpace = (currentLineSegments.length > 0 ? spaceWidth : 0) + wordWidth;

            if (currentLineWidth + wordWidthWithSpace > maxWidth) {
                // Finish current line and start a new one
                if (currentLineSegments.length > 0) {
                    lines.push(currentLineSegments);
                }
                // Start new line with the current word
                currentLineSegments = [{ text: word, font: segmentFont, width: wordWidth }];
                currentLineWidth = wordWidth;
            } else {
                // Add word to current line
                 if (currentLineSegments.length > 0) { // Add space before word if not first word
                    currentLineSegments.push({ text: ' ', font: fontRegular, width: spaceWidth });
                    currentLineWidth += spaceWidth;
                 }
                 currentLineSegments.push({ text: word, font: segmentFont, width: wordWidth });
                 currentLineWidth += wordWidth;
            }
        }
    }

    // Add the last line if it has content
    if (currentLineSegments.length > 0) {
        lines.push(currentLineSegments);
    }

    return lines;
}

async function mergeStudentPDFs(mainDirectory, outputDirectory, templateContent) {
    console.log("Starting PDF Merging Process...");
    const pdfsSubDirectory = path.join(outputDirectory, 'pdfs'); // pdfs still at root level
    if (!fs.existsSync(pdfsSubDirectory)) {
        console.log(`Creating PDF output directory: ${pdfsSubDirectory}`);
        fs.mkdirSync(pdfsSubDirectory, { recursive: true });
    }

    const pagesDirectory = path.join(outputDirectory, 'pages'); // Define path to 'pages' dir
    if (!fs.existsSync(pagesDirectory)) {
        console.error(`Error: Pages directory not found at ${pagesDirectory}. Run Transformation first.`);
        throw new Error(`Pages directory not found: ${pagesDirectory}.`);
    }

    // Read student identifiers from the 'pages' subdirectory
    const studentIdentifiers = fs.readdirSync(pagesDirectory).filter(dir => {
        const dirPath = path.join(pagesDirectory, dir);
        // Check if it's a directory AND not named 'pdfs' or 'booklets' (redundant check, but safe)
        return fs.statSync(dirPath).isDirectory() && dir !== 'pdfs' && dir !== 'booklets';
    }).sort();
    console.log(`Found ${studentIdentifiers.length} student identifier directories in ${pagesDirectory}.`);

    for (const studentIdentifier of studentIdentifiers) {
        console.log(`Processing student identifier: ${studentIdentifier}`);
        // Construct path to student dir inside 'pages'
        const studentDirPath = path.join(pagesDirectory, studentIdentifier);

        // --- Read Processed File Info --- 
        let processedFilesData = []; // Array of { pageName, originalFileName, studentInfo }
        const infoFilePath = path.join(studentDirPath, 'processed_files.json');
        let studentInfoForCover = null; // Store student info for the cover sheet
        try {
            if (fs.existsSync(infoFilePath)) {
                processedFilesData = JSON.parse(fs.readFileSync(infoFilePath, 'utf-8'));
                console.log(`  Loaded ${processedFilesData.length} processed file entries for ${studentIdentifier}.`);
                // Get studentInfo from the first entry (should be consistent)
                if (processedFilesData.length > 0 && processedFilesData[0].studentInfo) {
                    studentInfoForCover = processedFilesData[0].studentInfo;
                } else {
                    console.warn(`  Could not extract studentInfo from processed_files.json for ${studentIdentifier}`);
                    // Create a fallback studentInfo object
                    studentInfoForCover = { primaryIdentifier: studentIdentifier, fullName: studentIdentifier }; 
                }
            } else {
                console.warn(`  Processed file info not found for ${studentIdentifier} at ${infoFilePath}`);
                // Create a fallback studentInfo object if file is missing
                studentInfoForCover = { primaryIdentifier: studentIdentifier, fullName: studentIdentifier }; 
            }
        } catch (err) {
            console.error(`  Error reading processed file info for ${studentIdentifier}:`, err);
            // Create a fallback studentInfo object on error
            studentInfoForCover = { primaryIdentifier: studentIdentifier, fullName: studentIdentifier }; 
        }
        // --- End Read --- 

        // Find the generated PDFs for merging within the student's directory in 'pages'
        const studentPDFs = fs.readdirSync(studentDirPath)
                             .filter(file => file.endsWith('.pdf') && file !== 'processed_files.json') // Exclude json file
                             .sort(); 

        if (studentPDFs.length === 0 && processedFilesData.length === 0) {
            console.log(`  No transformed PDFs or processed info found for ${studentIdentifier}, skipping merge.`);
            continue; 
        }
        console.log(`  Found ${studentPDFs.length} PDF file(s) and ${processedFilesData.length} processed file entries.`);

        const mergedPdf = await PDFDocument.create();
        let width = 595.28, height = 841.89; 
        let dimensionsDetermined = false;

        // --- Build Submitted List String from Processed Info --- 
        // Sort processedFilesData by pageName before creating the string
        const sortedProcessedFiles = [...processedFilesData].sort((a, b) => {
            // Basic lexicographical sort on pageName
            return a.pageName.localeCompare(b.pageName);
        });

        const submittedSeitenListString = sortedProcessedFiles.length > 0 
            ? sortedProcessedFiles.map(info => `- ${info.pageName}: ${info.originalFileName}`).join('\n')
            : 'None';
        const pagesSuccessfullyMerged = []; // Track pages we actually add
        const pagesFailedToMerge = []; // Track pages that failed
        // --- End Build List --- 

        // Merge actual PDF content (looping through found PDFs)
        for (const pdfFile of studentPDFs) {
            const pdfPathToMerge = path.join(studentDirPath, pdfFile); // Full path to PDF inside student dir
            try {
                const pdfBuffer = fs.readFileSync(pdfPathToMerge);
                const pdfDoc = await PDFDocument.load(pdfBuffer); // Load potentially problematic PDF

                if (!dimensionsDetermined) {
                    const [firstPage] = pdfDoc.getPages();
                    width = firstPage.getWidth();
                    height = firstPage.getHeight();
                    dimensionsDetermined = true;
                    console.log(`  Determined page dimensions from ${pdfFile}: ${width}x${height}`);
                }

                const [page] = await mergedPdf.copyPages(pdfDoc, [0]); // Copy page
                mergedPdf.addPage(page);
                pagesSuccessfullyMerged.push(path.basename(pdfFile, '.pdf')); // Add page name (without .pdf)
            } catch (mergeError) {
                const pageName = path.basename(pdfFile, '.pdf');
                const errorMsg = `Error merging page ${pageName} for ${studentIdentifier}: ${mergeError.message}`;
                console.error(errorMsg);
                // TODO: Send error to UI log via main process
                // We need a way to communicate this back to main.js to send IPC message.
                // For now, just console log and track failure.
                pagesFailedToMerge.push(pageName);
            }
        }

        // Determine missing pages based on processed page names
	    const seiteFolders = fs.readdirSync(mainDirectory).filter(item => {
	        const itemPath = path.join(mainDirectory, item);
	        return fs.statSync(itemPath).isDirectory();
	    });
        const submittedPageNames = sortedProcessedFiles.map(info => info.pageName); // Use sorted list for accurate missing check
        const missingSeiten = seiteFolders.filter(seite => !submittedPageNames.includes(seite));
        // Add pages that failed to merge to the missing list as well
        const finalMissingSeiten = [...new Set([...missingSeiten, ...pagesFailedToMerge])].sort();
        console.log(`  Submitted based on processed info: ${submittedPageNames.length}, Merged successfully: ${pagesSuccessfullyMerged.length}, Failed/Missing: ${finalMissingSeiten.length}`);

        // Generate cover sheet using the studentInfo object and template CONTENT
        // Pass the updated missing list
        const coverSheet = await generateCoverSheet(templateContent, submittedSeitenListString, finalMissingSeiten, studentInfoForCover, width, height);
        const [coverPage] = await mergedPdf.copyPages(coverSheet, [0]);
        mergedPdf.insertPage(0, coverPage);
        console.log(`  Generated and added cover sheet.`);

        const outputPdfFileName = `${studentInfoForCover.primaryIdentifier || studentIdentifier}.pdf`; // Use primary ID if available
        const outputPath = path.join(pdfsSubDirectory, outputPdfFileName); // Output merged PDF to root 'pdfs' dir
        
        // Try saving the final merged PDF
        try {
            fs.writeFileSync(outputPath, await mergedPdf.save());
            console.log(`  Successfully merged and saved to: ${outputPath}`);
        } catch (saveError) {
            const saveErrorMsg = `Error saving final merged PDF for ${studentIdentifier}: ${saveError.message}`;
            console.error(saveErrorMsg);
            // TODO: Send error to UI log via main process
            // Create placeholder in pdfs folder
            const errorFilePath = outputPath.replace(/\.pdf$/, '_merge_error.txt');
            try {
                fs.writeFileSync(errorFilePath, `Failed to save merged PDF.\nError: ${saveError.message}\n${saveError.stack || ''}`);
                console.log(`Created error placeholder: ${errorFilePath}`);
            } catch (writeError) {
                console.error(`Failed to write merge error placeholder for ${studentIdentifier}: ${writeError.message}`);
            }
            // Indicate failure if needed, maybe throw error to main?
        }
    }
    console.log("PDF Merging Process Completed.");
}

/**
 * Processes a single input file (PDF, PNG, JPG, HEIC) into an A5 PDF page.
 * @param {string} inputPath Path to the input file.
 * @param {string} outputPath Path to save the resulting single-page PDF.
 * @param {number} dpiValue DPI for PDF rendering (if applicable).
 * @param {function} [sendLog=console.log] Function to send log messages.
 */
async function processSingleTransformation(inputPath, outputPath, dpiValue, sendLog = console.log) {
    const ext = path.extname(inputPath).toLowerCase(); 
    // Get last 3 path parts for logging (e.g., PageDir/StudentDir/file.ext)
    const logInputPath = inputPath.split(path.sep).slice(-3).join(path.sep);
    const logOutputPath = outputPath.split(path.sep).slice(-3).join(path.sep);
    let imageBufferForPdfLib; // Buffer ready to be embedded (always PNG format)
    let needsRotation = false;

    sendLog(`[Transform Single] Starting: ${logInputPath} -> ${logOutputPath}, Ext=${ext}`);

    try {
        let initialBuffer; // Buffer directly from file or rendering

        if (ext === '.pdf') {
            sendLog(`[Transform Single] Processing as PDF: ${logInputPath}`);
            initialBuffer = await renderFirstPageToImage(inputPath, dpiValue); // Renders first page to PNG buffer
        } else if (ext === '.png') {
            sendLog(`[Transform Single] Processing as PNG: ${logInputPath}`);
            initialBuffer = fs.readFileSync(inputPath);
        } else if (ext === '.jpg' || ext === '.jpeg') {
            sendLog(`[Transform Single] Processing as JPG/JPEG: ${logInputPath}`);
            initialBuffer = fs.readFileSync(inputPath);
            // Convert to PNG later if needed (e.g., for rotation check/apply)
        } else if (ext === '.heic') {
            sendLog(`[Transform Single] Processing as HEIC: ${logInputPath}`);
            const heicBuffer = fs.readFileSync(inputPath);
            const { data, width, height } = await decodeHeic({ buffer: heicBuffer });
            sendLog(`[Transform Single] Decoded HEIC to raw data (${width}x${height}): ${logInputPath}`);
            // Convert raw to PNG buffer now
            initialBuffer = await sharp(data, {
                raw: {
                    width: width,
                    height: height,
                    channels: 4
                }
            }).png().toBuffer();
            sendLog(`[Transform Single] Converted HEIC raw data to PNG buffer: ${logInputPath}`);
        } else {
            sendLog(`[Transform Single] WARN: Skipping unsupported file type: ${logInputPath}`);
            return; 
        }

        if (!initialBuffer) {
             sendLog(`[Transform Single] ERROR: Failed to get initial buffer for ${logInputPath}`);
             return;
        }

        // Check dimensions and determine rotation need using Sharp
        const metadata = await sharp(initialBuffer).metadata();
        sendLog(`[Transform Single] Image dimensions: ${metadata.width}x${metadata.height} for ${logInputPath}`);
        if (metadata.width > metadata.height) {
            sendLog(`[Transform Single] Image is landscape (width > height), rotation needed: ${logInputPath}`);
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
            sendLog(`[Transform Single] Successfully created PDF page: ${logOutputPath}`);
        } else {
             sendLog(`[Transform Single] ERROR: Failed to get final image buffer for ${logInputPath}`);
        }

    } catch (error) {
        sendLog(`[Transform Single] ERROR processing file ${logInputPath}: ${error.message}`);
        throw error; 
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
    processSingleTransformation,
    createSaddleStitchBooklet,
};
