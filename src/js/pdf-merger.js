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

// Simple name parsing (adjust if name format differs)
function parseStudentName(fullName) {
    const parts = fullName.trim().split(/\s+/);
    const lastName = parts.pop() || ''; // Assume last part is last name
    const firstName = parts.join(' ');
    return { firstName, lastName };
}

async function generateCoverSheet(templatePath, submittedSeiten, missingSeiten, studentName, width, height) {
    let templateContent;
    try {
        templateContent = fs.readFileSync(templatePath, 'utf-8');
    } catch (err) {
        console.error(`Error reading cover sheet template ${templatePath}:`, err);
        templateContent = `# Error: Template Not Found

Could not load template file at: ${templatePath}

Student: {{LAST_NAME}}, {{FIRST_NAME}}

**Submitted Pages:**
{{SUBMITTED_PAGES_LIST}}

**Missing Pages:**
{{MISSING_PAGES_LIST}}`;
    }

    const { firstName, lastName } = parseStudentName(studentName);
    const missingList = missingSeiten.length > 0 ? missingSeiten.join('\n') : 'None';

    // Replace template tags (add name tags)
    let processedContent = templateContent
        .replace(/\{\{\s*FULL_NAME\s*\}\}/gi, studentName) // Add FULL_NAME
        .replace(/\{\{\s*LAST_NAME\s*\}\}/gi, lastName)
        .replace(/\{\{\s*FIRST_NAME\s*\}\}/gi, firstName)
        .replace(/\{\{\s*SUBMITTED_PAGES_LIST\s*\}\}/gi, submittedSeiten)
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

async function mergeStudentPDFs(mainDirectory, outputDirectory, templateFilePath) {
    console.log("Starting PDF Merging Process...");
    const pdfsSubDirectory = path.join(outputDirectory, 'pdfs');
    if (!fs.existsSync(pdfsSubDirectory)) {
        console.log(`Creating PDF output directory: ${pdfsSubDirectory}`);
        fs.mkdirSync(pdfsSubDirectory, { recursive: true });
    }

    const studentDirectories = fs.readdirSync(outputDirectory).filter(
        dir => dir !== 'pdfs' && dir !== 'booklets' &&
        fs.statSync(path.join(outputDirectory, dir)).isDirectory()).sort();
    console.log(`Found ${studentDirectories.length} student directories in output.`);

    // Removed reading description file - template is now separate
    // const template = fs.readFileSync(descriptionFilePath, 'utf-8'); 

    // Determine path to template file (assuming root for now, adjust if needed)
    const actualTemplatePath = path.resolve(templateFilePath || 'cover-template.md'); 
     console.log(`Using cover sheet template: ${actualTemplatePath}`);
     if (!fs.existsSync(actualTemplatePath)) {
         console.error(`TEMPLATE FILE NOT FOUND: ${actualTemplatePath}`);
         // Decide how to handle - throw error or use default content in generateCoverSheet
     }

    for (const studentName of studentDirectories) {
        console.log(`Processing student: ${studentName}`);
        const studentDirPath = path.join(outputDirectory, studentName);

        // --- Read Processed File Info --- 
        let processedFilesInfo = []; // Array of { pageName: string, originalFileName: string }
        const infoFilePath = path.join(studentDirPath, 'processed_files.json');
        try {
            if (fs.existsSync(infoFilePath)) {
                processedFilesInfo = JSON.parse(fs.readFileSync(infoFilePath, 'utf-8'));
                console.log(`  Loaded processed file info for ${studentName}.`);
            } else {
                console.warn(`  Processed file info not found for ${studentName} at ${infoFilePath}`);
            }
        } catch (err) {
            console.error(`  Error reading processed file info for ${studentName}:`, err);
        }
        // --- End Read --- 

        // Find the generated PDFs for merging (still needed for content)
        const studentPDFs = fs.readdirSync(studentDirPath)
                             .filter(file => file.endsWith('.pdf') && file !== `${studentName}.pdf`)
                             .sort(); // Exclude final merged PDF if it exists from previous run

        if (studentPDFs.length === 0 && processedFilesInfo.length === 0) { // Check both sources
            console.log(`  No transformed PDFs or processed info found for ${studentName}, skipping merge.`);
            continue; 
        }
        console.log(`  Found ${studentPDFs.length} PDF file(s) and ${processedFilesInfo.length} processed file entries.`);

        const mergedPdf = await PDFDocument.create();
        // const submittedSeiten = []; // We'll build the list string directly
        let width = 595.28, height = 841.89; 
        let dimensionsDetermined = false;

        // --- Build Submitted List String from Processed Info --- 
        const submittedPageNames = processedFilesInfo.map(info => info.pageName);
        const submittedSeitenListString = processedFilesInfo.length > 0 
            ? processedFilesInfo.map(info => `- ${info.pageName}: ${info.originalFileName}`).join('\n')
            : 'None';
        // --- End Build List --- 

        // Merge actual PDF content (looping through found PDFs)
        for (const pdfFile of studentPDFs) {
            const pdfBuffer = fs.readFileSync(path.join(studentDirPath, pdfFile));
            const pdfDoc = await PDFDocument.load(pdfBuffer);

            if (!dimensionsDetermined) {
                const [firstPage] = pdfDoc.getPages();
                width = firstPage.getWidth();
                height = firstPage.getHeight();
                dimensionsDetermined = true;
                console.log(`  Determined page dimensions from ${pdfFile}: ${width}x${height}`);
            }

            const [page] = await mergedPdf.copyPages(pdfDoc, [0]);
            mergedPdf.addPage(page);
            // const seiteName = path.basename(pdfFile, '.pdf'); // Old way
            // submittedSeiten.push(seiteName);
        }

        // Determine missing pages based on processed page names
        const seiteFolders = fs.readdirSync(mainDirectory).filter(item => {
	        const itemPath = path.join(mainDirectory, item);
	        return fs.statSync(itemPath).isDirectory();
	    });
        const missingSeiten = seiteFolders.filter(seite => !submittedPageNames.includes(seite));
        console.log(`  Submitted based on processed info: ${submittedPageNames.length}, Missing: ${missingSeiten.length}`);

        // Generate cover sheet using the new list string
        const coverSheet = await generateCoverSheet(actualTemplatePath, submittedSeitenListString, missingSeiten, studentName, width, height);
        const [coverPage] = await mergedPdf.copyPages(coverSheet, [0]);
        mergedPdf.insertPage(0, coverPage);
        console.log(`  Generated and added cover sheet.`);

        const outputPath = path.join(pdfsSubDirectory, `${studentName}.pdf`);
        fs.writeFileSync(outputPath, await mergedPdf.save());
        console.log(`  Successfully merged and saved to: ${outputPath}`);
    }
    console.log("PDF Merging Process Completed.");
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
                if (!fs.existsSync(studentOutputDirectory)){
                    console.log(`[Prepare] Creating output directory: ${studentOutputDirectory}`);
                    fs.mkdirSync(studentOutputDirectory, { recursive: true });
                }
                const originalFileName = processableFiles[0];
                const inputPath = path.join(studentFolderPath, originalFileName);
                const outputPath = path.join(studentOutputDirectory, `${subdir}.pdf`); // Output is always .pdf
                transformationTasks.push({ 
                    inputPath, 
                    outputPath, 
                    originalFileName: originalFileName, // Add original filename
                    pageName: subdir                 // Add page name (subdir)
                });
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
