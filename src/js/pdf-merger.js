const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFPage, StandardFonts, rgb } = require('pdf-lib');
const fontkit = require('fontkit');
const sharp = require('sharp');
const decodeHeic = require('heic-decode');
const { marked } = require('marked');
const { renderFirstPageToImage, imageToPdf } = require('./pdf-cmdline-processor');
const { analyzeMargins } = require('./margin-analyzer');
const { generatePageCountSummary } = require('./page-count-summary');

const SHARP_PIXEL_LIMIT = 268402689 * 4; // 4x default limit for large images

/**
 * Yield to the event loop and check whether the user has requested an abort.
 * @returns {boolean} True if abort was requested.
 */
async function checkAborted() {
    await new Promise(resolve => setTimeout(resolve, 0));
    return global.abortProcessingFlag;
}

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

// --- Shared Unicode-to-ASCII character map (used by both sanitization functions) ---
const UNICODE_CHAR_MAP = {
    // German umlauts
    'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss',
    'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue',
    // French accents
    'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'å': 'a',
    'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
    'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
    'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o',
    'ù': 'u', 'ú': 'u', 'û': 'u',
    'ñ': 'n', 'ç': 'c',
    'À': 'A', 'Á': 'A', 'Â': 'A', 'Ã': 'A', 'Å': 'A',
    'È': 'E', 'É': 'E', 'Ê': 'E', 'Ë': 'E',
    'Ì': 'I', 'Í': 'I', 'Î': 'I', 'Ï': 'I',
    'Ò': 'O', 'Ó': 'O', 'Ô': 'O', 'Õ': 'O',
    'Ù': 'U', 'Ú': 'U', 'Û': 'U',
    'Ñ': 'N', 'Ç': 'C',
    'ÿ': 'y', 'Ÿ': 'Y',
    // Combining diacritical marks (fallback, should be handled by NFC normalization)
    '\u0300': '', '\u0301': '', '\u0302': '', '\u0303': '', '\u0304': '',
    '\u0305': '', '\u0306': '', '\u0307': '', '\u0308': '', '\u0309': '',
    '\u030A': '', '\u030B': '', '\u030C': '', '\u030D': '', '\u030E': '',
    '\u030F': '', '\u0310': '', '\u0311': '', '\u0312': '', '\u0313': '',
    '\u0314': '', '\u0315': '', '\u0316': '', '\u0317': '', '\u0318': '',
    '\u0319': '', '\u031A': '', '\u031B': '', '\u031C': '', '\u031D': '',
    '\u031E': '', '\u031F': '', '\u0320': '', '\u0321': '', '\u0322': '',
    '\u0323': '', '\u0324': '', '\u0325': '', '\u0326': '', '\u0327': '',
    '\u0328': '', '\u0329': '', '\u032A': '', '\u032B': '', '\u032C': '',
    '\u032D': '', '\u032E': '', '\u032F': '', '\u0330': '', '\u0331': '',
    '\u0332': '', '\u0333': '', '\u0334': '', '\u0335': '', '\u0336': '',
};

// --- Text Sanitization for WinAnsi Compatibility ---
function sanitizeTextForWinAnsi(text) {
    const normalizedText = text.normalize('NFC');
    console.log(`Sanitizing text for WinAnsi: "${text}" -> normalized: "${normalizedText}"`);

    return normalizedText.replace(/[\u0080-\uFFFF]/g, function(match) {
        return UNICODE_CHAR_MAP[match] || '?';
    });
}

// --- Filename Sanitization for Filesystem Compatibility ---
function sanitizeFilename(filename) {
    const normalizedFilename = filename.normalize('NFC');
    console.log(`Sanitizing filename: "${filename}" -> normalized: "${normalizedFilename}"`);

    // Replace Unicode characters with ASCII equivalents using the shared char map,
    // then replace any remaining non-ASCII characters with 'X'
    let sanitized = normalizedFilename.replace(/[\u0080-\uFFFF]/g, function(match) {
        if (UNICODE_CHAR_MAP[match] !== undefined) return UNICODE_CHAR_MAP[match];
        console.log(`Unmapped Unicode character found: "${match}" (U+${match.charCodeAt(0).toString(16).toUpperCase()})`);
        return 'X';
    });

    console.log(`Sanitized result: "${sanitized}"`);

    // Remove or replace characters that are problematic in filenames
    sanitized = sanitized
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/[\x00-\x1f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\.$/, '');

    return sanitized || 'sanitized_filename';
}
/**
 * Returns candidate base paths for bundled font files (dev + production layouts).
 */
function getFontBasePaths() {
    const paths = [
        path.join(__dirname, '../assets/fonts'),
        path.join(__dirname, '../../src/assets/fonts'),
    ];
    if (typeof process.resourcesPath === 'string') {
        paths.push(
            path.join(process.resourcesPath, 'app.asar.unpacked/src/assets/fonts'),
            path.join(process.resourcesPath, 'src/assets/fonts'),
        );
    }
    return paths;
}

/**
 * Finds the first existing font file by name across all candidate base paths.
 * @param {string} fontFileName - e.g. 'Roboto-Bold.ttf'
 * @returns {string|null} Absolute path to the font file, or null if not found.
 */
function findFontPath(fontFileName) {
    for (const basePath of getFontBasePaths()) {
        const fullPath = path.join(basePath, fontFileName);
        if (fs.existsSync(fullPath)) return fullPath;
    }
    return null;
}

async function generateCoverSheet(templateContent, submittedSeitenListString, missingSeiten, studentInfo, width, height, sendLog = console.log) {
    if (!templateContent) {
        sendLog('Warning: No cover sheet template content provided, using fallback.');
        // Provide a minimal fallback if content is empty or null
        templateContent = `# Error: Template Missing

Student: {{LAST_NAME}}, {{FIRST_NAME}}

**Submitted Pages:**
{{SUBMITTED_PAGES_LIST}}

**Missing Pages:**
{{MISSING_PAGES_LIST}}`;
    }

    // Extract info, providing defaults and NFC-normalize Unicode
    const fullName = (studentInfo?.fullName || 'Unknown Name').normalize('NFC');
    const firstName = (studentInfo?.firstName || '').normalize('NFC');
    const lastName = (studentInfo?.lastName || 'Unknown').normalize('NFC');
    const studentNumber = studentInfo?.studentNumber || '\u2013'; // en-dash if not available

    // Sort the missing pages list numerically
    const sortedMissingSeiten = [...missingSeiten].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );
    const missingList = sortedMissingSeiten.length > 0 ? sortedMissingSeiten.join('\n') : 'None';

    // Replace template tags
    let processedContent = templateContent
        .replace(/\{\{\s*FULL_NAME\s*\}\}/gi, fullName)
        .replace(/\{\{\s*LAST_NAME\s*\}\}/gi, lastName)
        .replace(/\{\{\s*FIRST_NAME\s*\}\}/gi, firstName)
        .replace(/\{\{\s*STUDENTNUMBER\s*\}\}/gi, studentNumber)
        .replace(/\{\{\s*SUBMITTED_PAGES_LIST\s*\}\}/gi, submittedSeitenListString)
        .replace(/\{\{\s*MISSING_PAGES_LIST\s*\}\}/gi, missingList);

    const pdfDoc = await PDFDocument.create();
    
    // Register fontkit to enable custom font embedding
    pdfDoc.registerFontkit(fontkit);
    
    const page = pdfDoc.addPage([width, height]);
    
    // Use Roboto fonts for Unicode support (including umlauts), fall back to Helvetica
    let helvetica, helveticaBold;

    try {
        const robotoRegularPath = findFontPath('Roboto-Regular.ttf');
        const robotoBoldPath = findFontPath('Roboto-Bold.ttf');

        if (!robotoRegularPath || !robotoBoldPath) {
            throw new Error('Roboto fonts not found in any of the expected locations');
        }

        helvetica = await pdfDoc.embedFont(fs.readFileSync(robotoRegularPath));
        helveticaBold = await pdfDoc.embedFont(fs.readFileSync(robotoBoldPath));
    } catch (fontError) {
        sendLog(`Warning: Could not load Roboto fonts, falling back to standard fonts with text sanitization: ${fontError.message}`);

        helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
        helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        // Sanitize text to replace characters unsupported by WinAnsi encoding
        processedContent = sanitizeTextForWinAnsi(processedContent);
    }

    // Settings for drawing
    const margin = 50;
    let currentY = height - margin; // Start from top margin
    const lineSpacing = 6;
    const paragraphSpacing = 12;
    const listIndent = 20;
    const baseFontSize = 9;
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
                    font: helveticaBold,
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

/**
 * Apply a sort-order override to a studentInfo object.
 * Tries fullName first, then falls back to the directory identifier.
 * Returns true if an override was applied.
 */
function applySortOrderOverride(studentInfo, identifier, sortOrderOverrides) {
    const override = sortOrderOverrides[studentInfo.fullName] || sortOrderOverrides[identifier];
    if (override) {
        studentInfo.lastName = override.lastName;
        studentInfo.firstName = override.firstName;
        return true;
    }
    return false;
}

async function mergeStudentPDFs(mainDirectory, outputDirectory, templateContent, options = {}, sendLog = console.log, onProgress = null) {
    sendLog('Starting PDF Merging Process...');
    const pdfsSubDirectory = path.join(outputDirectory, 'pdfs'); // pdfs still at root level
    if (!fs.existsSync(pdfsSubDirectory)) {
        sendLog(`Creating PDF output directory: ${pdfsSubDirectory}`);
        fs.mkdirSync(pdfsSubDirectory, { recursive: true });
    }

    const pagesDirectory = path.join(outputDirectory, 'pages'); // Define path to 'pages' dir
    if (!fs.existsSync(pagesDirectory)) {
        sendLog(`Error: Pages directory not found at ${pagesDirectory}. Run Transformation first.`);
        throw new Error(`Pages directory not found: ${pagesDirectory}.`);
    }

    // Read student identifiers from the 'pages' subdirectory
    const studentIdentifiers = fs.readdirSync(pagesDirectory).filter(dir => {
        const dirPath = path.join(pagesDirectory, dir);
        // Check if it's a directory AND not named 'pdfs' or 'booklets' (redundant check, but safe)
        return fs.statSync(dirPath).isDirectory() && dir !== 'pdfs' && dir !== 'booklets';
    });
    sendLog(`Found ${studentIdentifiers.length} student identifier directories in ${pagesDirectory}.`);

    // Read sort-order.txt if present (provides name overrides AND print order)
    const sortOrderPath = path.join(outputDirectory, 'sort-order.txt');
    const sortOrderOverrides = {}; // folderName → { lastName, firstName }
    const sortOrderSequence = []; // folderNames in file line order (= print order)
    if (fs.existsSync(sortOrderPath)) {
        try {
            const sortOrderContent = fs.readFileSync(sortOrderPath, 'utf-8');
            const sortOrderLines = sortOrderContent.split('\n');
            for (const line of sortOrderLines) {
                if (line.startsWith('#') || !line.trim()) continue;
                const parts = line.split('\t');
                if (parts.length >= 3) {
                    const folderName = parts[0].trim();
                    const lastName = parts[1].trim();
                    const firstName = parts[2].trim();
                    if (folderName) {
                        if (!sortOrderOverrides[folderName]) {
                            sortOrderOverrides[folderName] = { lastName, firstName };
                            sortOrderSequence.push(folderName);
                        } else {
                            sendLog(`  Warning: Duplicate entry in sort-order.txt: "${folderName}" — using first occurrence.`);
                        }
                    }
                }
            }
            sendLog(`Loaded ${Object.keys(sortOrderOverrides).length} entries from sort-order.txt (line order = print order)`);
        } catch (err) {
            sendLog(`  Warning: Could not read sort-order.txt: ${err.message}`);
        }
    }

    // Collect student info
    const studentsWithInfo = [];
    for (const studentIdentifier of studentIdentifiers) {
        const studentDirPath = path.join(pagesDirectory, studentIdentifier);
        const infoFilePath = path.join(studentDirPath, 'processed_files.json');
        let studentInfo = { primaryIdentifier: studentIdentifier, fullName: studentIdentifier, lastName: studentIdentifier };

        if (fs.existsSync(infoFilePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(infoFilePath, 'utf-8'));
                if (data && Array.isArray(data.processedFiles) && data.processedFiles.length > 0 && data.processedFiles[0].studentInfo) {
                    studentInfo = data.processedFiles[0].studentInfo;
                }
            } catch (err) {
                sendLog(`  Warning: Could not read student info for ${studentIdentifier}, using fallback`);
            }
        }

        // Apply sort-order.txt overrides (try fullName first, then directory name)
        if (applySortOrderOverride(studentInfo, studentIdentifier, sortOrderOverrides)) {
            sendLog(`  Applied sort-order override for ${studentInfo.fullName || studentIdentifier}: ${studentInfo.lastName}, ${studentInfo.firstName}`);
        }

        studentsWithInfo.push({
            identifier: studentIdentifier,
            info: studentInfo,
            dirPath: studentDirPath
        });
    }

    // Sort: use sort-order.txt line order if available, otherwise alphabetical by last name
    function compareByLastName(a, b) {
        const lastNameA = a.info.lastName || a.identifier;
        const lastNameB = b.info.lastName || b.identifier;
        return lastNameA.localeCompare(lastNameB, 'de', { numeric: true });
    }

    if (sortOrderSequence.length > 0) {
        // Build position lookup from sort-order.txt (by folderName and by fullName)
        const positionMap = new Map();
        for (let i = 0; i < sortOrderSequence.length; i++) {
            positionMap.set(sortOrderSequence[i], i);
        }

        function getPosition(student) {
            return positionMap.get(student.identifier) ?? positionMap.get(student.info.fullName);
        }

        studentsWithInfo.sort((a, b) => {
            const posA = getPosition(a);
            const posB = getPosition(b);
            const hasA = posA !== undefined;
            const hasB = posB !== undefined;

            // Students in sort-order.txt come first, in file line order
            if (hasA && hasB) return posA - posB;
            if (hasA && !hasB) return -1;
            if (!hasA && hasB) return 1;

            // Students not in sort-order.txt: alphabetical fallback
            return compareByLastName(a, b);
        });

        const unmatchedCount = studentsWithInfo.filter(s => getPosition(s) === undefined).length;
        if (unmatchedCount > 0) {
            sendLog(`  Warning: ${unmatchedCount} student(s) not found in sort-order.txt — appended alphabetically at the end.`);
        }
        sendLog(`Sorted ${studentsWithInfo.length} students by sort-order.txt line order for processing.`);
    } else {
        // No sort-order.txt or empty: alphabetical fallback
        studentsWithInfo.sort(compareByLastName);
        sendLog(`Sorted ${studentsWithInfo.length} students alphabetically by last name for processing.`);
    }

    for (let i = 0; i < studentsWithInfo.length; i++) {
        if (await checkAborted()) {
            sendLog(`Merge aborted by user after ${i} of ${studentsWithInfo.length} student(s).`);
            throw new Error(`Merge aborted. ${i} of ${studentsWithInfo.length} student(s) completed.`);
        }

        const student = studentsWithInfo[i];
        const studentIdentifier = student.identifier;
        const studentNumber = String(i + 1).padStart(3, '0'); // 001, 002, 003, etc.

        sendLog(`Processing student ${studentNumber}: ${studentIdentifier}`);
        if (onProgress) {
            onProgress({
                current: i + 1,
                total: studentsWithInfo.length,
                percentage: Math.round(((i + 1) / studentsWithInfo.length) * 100),
                fileName: student.info?.fullName || studentIdentifier
            });
        }
        const studentDirPath = student.dirPath;

        // --- Read Processed File Info (reuse studentInfo from sorting phase) ---
        let processedFilesData = [];
        const infoFilePath = path.join(studentDirPath, 'processed_files.json');
        let studentInfoForCover = student.info; // Reuse info already loaded during sorting

        if (fs.existsSync(infoFilePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(infoFilePath, 'utf-8'));

                if (data && Array.isArray(data.processedFiles)) {
                    processedFilesData = data.processedFiles;
                    sendLog(`  Loaded ${processedFilesData.length} processed file entries for ${studentIdentifier}.`);
                } else {
                    sendLog(`  Warning: 'processedFiles' key missing or not an array in ${infoFilePath} for ${studentIdentifier}. Using empty list.`);
                }

                // Use studentInfo from the first processed entry when available (more detailed than folder-parsed info)
                if (processedFilesData.length > 0 && processedFilesData[0].studentInfo) {
                    studentInfoForCover = processedFilesData[0].studentInfo;
                    // studentInfoForCover is a separate object from the JSON; re-apply
                    // sort-order overrides so the cover sheet reflects any manual edits.
                    applySortOrderOverride(studentInfoForCover, studentIdentifier, sortOrderOverrides);
                }
            } catch (err) {
                sendLog(`  Error reading or parsing processed file info for ${studentIdentifier}: ${err.message}`);
            }
        } else {
            sendLog(`  Warning: Processed file info not found for ${studentIdentifier} at ${infoFilePath}`);
        }
        // --- End Read ---

        // Find the generated PDFs for merging within the student's directory in 'pages'
        const studentPDFs = fs.readdirSync(studentDirPath)
                             .filter(file => file.endsWith('.pdf') && file !== 'processed_files.json') // Exclude json file
                             .sort((a, b) => {
                                 // Natural sort to handle numeric ordering (1.pdf, 2.pdf, 10.pdf, 11.pdf)
                                 const nameA = path.basename(a, '.pdf');
                                 const nameB = path.basename(b, '.pdf');
                                 return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
                             }); 

        if (studentPDFs.length === 0 && processedFilesData.length === 0) {
            sendLog(`  No transformed PDFs or processed info found for ${studentIdentifier}, skipping merge.`);
            continue; 
        }
        sendLog(`  Found ${studentPDFs.length} PDF file(s) and ${processedFilesData.length} processed file entries.`);

        const mergedPdf = await PDFDocument.create();
        let width = 595.28, height = 841.89; 
        let dimensionsDetermined = false;

        // --- Build Submitted List String from Processed Info --- 
        // Sort processedFilesData by pageName before creating the string
        const sortedProcessedFiles = processedFilesData.sort((a, b) => {
            // Natural sort (treats numbers numerically) on pageName
            return a.pageName.localeCompare(b.pageName, undefined, { numeric: true, sensitivity: 'base' });
        });

        const submittedSeitenListString = sortedProcessedFiles.length > 0 
            ? sortedProcessedFiles.map(info => {
                // Normalize Unicode characters in page names and file names
                const normalizedPageName = info.pageName.normalize('NFC');
                const normalizedFileName = info.originalFileName.normalize('NFC');
                return `- ${normalizedPageName}: ${normalizedFileName}`;
            }).join('\n')
            : 'None';
        const pagesSuccessfullyMerged = []; // Track pages we actually add
        const pagesFailedToMerge = []; // Track pages that failed
        // --- End Build List --- 

        // Merge actual PDF content (looping through found PDFs)
        for (const pdfFile of studentPDFs) {
            if (await checkAborted()) {
                throw new Error(`Merge aborted. Stopped during ${studentIdentifier} processing.`);
            }

            const pdfPathToMerge = path.join(studentDirPath, pdfFile); // Full path to PDF inside student dir
            try {
                const pdfBuffer = fs.readFileSync(pdfPathToMerge);
                const pdfDoc = await PDFDocument.load(pdfBuffer); // Load potentially problematic PDF

                if (!dimensionsDetermined) {
                    const [firstPage] = pdfDoc.getPages();
                    width = firstPage.getWidth();
                    height = firstPage.getHeight();
                    dimensionsDetermined = true;
                    sendLog(`  Determined page dimensions from ${pdfFile}: ${width}x${height}`);
                }

                const [page] = await mergedPdf.copyPages(pdfDoc, [0]); // Copy page
                mergedPdf.addPage(page);
                pagesSuccessfullyMerged.push(path.basename(pdfFile, '.pdf')); // Add page name (without .pdf)
            } catch (mergeError) {
                const pageName = path.basename(pdfFile, '.pdf');
                const errorMsg = `Error merging page ${pageName} for ${studentIdentifier}: ${mergeError.message}`;
                sendLog(errorMsg);
                pagesFailedToMerge.push(pageName);
            }
        }

        // Determine missing pages based on processed page names
	    const seiteFolders = fs.readdirSync(mainDirectory).filter(item => {
	        const itemPath = path.join(mainDirectory, item);
	        return fs.statSync(itemPath).isDirectory();
	    }).map(folder => folder.normalize('NFC')); // Normalize Unicode in folder names
        
        const submittedPageNames = sortedProcessedFiles.map(info => info.pageName.normalize('NFC')); // Normalize and use sorted list for accurate missing check
        const missingSeiten = seiteFolders.filter(seite => !submittedPageNames.includes(seite));
        
        // Add pages that failed to merge to the missing list as well (normalize these too)
        const normalizedFailedPages = pagesFailedToMerge.map(page => page.normalize('NFC'));
        const finalMissingSeiten = [...new Set([...missingSeiten, ...normalizedFailedPages])].sort((a, b) => {
            // Natural sort to handle numeric ordering (1, 2, 10, 11)
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        });
        sendLog(`  Submitted based on processed info: ${submittedPageNames.length}, Merged successfully: ${pagesSuccessfullyMerged.length}, Failed/Missing: ${finalMissingSeiten.length}`);

        // Generate cover sheet using the studentInfo object and template CONTENT
        // Pass the updated missing list
        const coverSheet = await generateCoverSheet(templateContent, submittedSeitenListString, finalMissingSeiten, studentInfoForCover, width, height, sendLog);
        const coverSheetPage = coverSheet.getPage(0);

        // Draw booklet number top-right on cover sheet
        const numberFontSize = 24;
        const boldFontPath = findFontPath('Roboto-Bold.ttf');
        let numberFont;
        try {
            numberFont = boldFontPath
                ? await coverSheet.embedFont(fs.readFileSync(boldFontPath))
                : await coverSheet.embedFont(StandardFonts.HelveticaBold);
        } catch (_) {
            numberFont = await coverSheet.embedFont(StandardFonts.HelveticaBold);
        }
        const numberWidth = numberFont.widthOfTextAtSize(studentNumber, numberFontSize);
        coverSheetPage.drawText(studentNumber, {
            x: width - 50 - numberWidth,
            y: height - 50,
            font: numberFont,
            size: numberFontSize,
            color: rgb(0.3, 0.3, 0.3),
        });

        const [coverPage] = await mergedPdf.copyPages(coverSheet, [0]);
        mergedPdf.insertPage(0, coverPage);
        sendLog(`  Generated and added cover sheet with number ${studentNumber}.`);

        // Pad to multiple of 4 pages if configured
        if (options.padToMultipleOf4) {
            const pageCount = mergedPdf.getPageCount();
            const pagesToAdd = (4 - (pageCount % 4)) % 4;
            for (let p = 0; p < pagesToAdd; p++) {
                const blankPage = mergedPdf.addPage([width, height]);
                // Draw an invisible dot to force pdf-lib to create a Contents stream,
                // otherwise embedPdf() fails with "missing Contents" during booklet creation.
                blankPage.drawCircle({ x: 0, y: 0, size: 0, opacity: 0 });
            }
            if (pagesToAdd > 0) {
                sendLog(`  Padded with ${pagesToAdd} blank page(s) (${pageCount} -> ${pageCount + pagesToAdd}).`);
            }
        }

        // Sanitize filename to prevent filesystem issues with non-ASCII characters
        const sanitizedIdentifier = sanitizeFilename(studentInfoForCover.primaryIdentifier || studentIdentifier);
        const outputPdfFileName = `${studentNumber}_${sanitizedIdentifier}.pdf`;
        const outputPath = path.join(pdfsSubDirectory, outputPdfFileName); // Output merged PDF to root 'pdfs' dir
        
        // Try saving the final merged PDF
        try {
            fs.writeFileSync(outputPath, await mergedPdf.save());
            sendLog(`  Successfully merged and saved to: ${outputPath}`);
        } catch (saveError) {
            const saveErrorMsg = `Error saving final merged PDF for ${studentIdentifier}: ${saveError.message}`;
            sendLog(saveErrorMsg);
            const errorFilePath = outputPath.replace(/\.pdf$/, '_merge_error.txt');
            try {
                fs.writeFileSync(errorFilePath, `Failed to save merged PDF.\nError: ${saveError.message}\n${saveError.stack || ''}`);
                sendLog(`Created error placeholder: ${errorFilePath}`);
            } catch (writeError) {
                sendLog(`Failed to write merge error placeholder for ${studentIdentifier}: ${writeError.message}`);
            }
            // Indicate failure if needed, maybe throw error to main?
        }
    }
    sendLog('PDF Merging Process Completed.');

    // Generate page count summary files (TXT + XLSX) — skip if aborted
    if (!global.abortProcessingFlag) {
        try {
            await generatePageCountSummary(outputDirectory, sendLog);
        } catch (summaryError) {
            sendLog(`Error generating page count summary: ${summaryError.message}`);
        }
    }
}

/**
 * Processes a single input file (PDF, PNG, JPG, HEIC) into an A5 PDF page.
 * @param {string} inputPath Path to the input file.
 * @param {string} outputPath Path to save the resulting single-page PDF.
 * @param {number} dpiValue DPI for PDF rendering (if applicable).
 * @param {function} [sendLog=console.log] Function to send log messages.
 * @param {Object} [options] Additional options.
 * @param {number} [options.marginMinMm=3.5] Minimum margin in mm.
 */
async function processSingleTransformation(inputPath, outputPath, dpiValue, sendLog = console.log, options = {}) {
    const ext = path.extname(inputPath).toLowerCase();
    const logInputPath = inputPath.split(path.sep).slice(-3).join(path.sep);
    const logOutputPath = outputPath.split(path.sep).slice(-3).join(path.sep);
    let marginResult = { needsMargin: false, scaleFactor: 1.0 };

    sendLog(`[Transform Single] Starting: ${logInputPath} -> ${logOutputPath}, Ext=${ext}`);

    try {
        let initialBuffer;

        if (ext === '.pdf') {
            sendLog(`[Transform Single] Processing as PDF: ${logInputPath}`);
            const statusCallback = (message) => sendLog(`[PDF Renderer] ${message}`);
            initialBuffer = await renderFirstPageToImage(inputPath, dpiValue, statusCallback);
        } else if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
            sendLog(`[Transform Single] Processing as ${ext.slice(1).toUpperCase()}: ${logInputPath}`);
            initialBuffer = fs.readFileSync(inputPath);
        } else if (ext === '.heic') {
            sendLog(`[Transform Single] Processing as HEIC: ${logInputPath}`);
            const heicBuffer = fs.readFileSync(inputPath);
            const { data, width, height } = await decodeHeic({ buffer: heicBuffer });
            sendLog(`[Transform Single] Decoded HEIC to raw data (${width}x${height}): ${logInputPath}`);
            initialBuffer = await sharp(data, {
                raw: { width, height, channels: 4 },
                limitInputPixels: SHARP_PIXEL_LIMIT
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

        // Check dimensions and determine rotation need
        const metadata = await sharp(initialBuffer, {
            limitInputPixels: SHARP_PIXEL_LIMIT
        }).metadata();

        sendLog(`[Transform Single] Image dimensions: ${metadata.width}x${metadata.height} for ${logInputPath}`);
        const needsRotation = metadata.width > metadata.height;
        if (needsRotation) {
            sendLog(`[Transform Single] Image is landscape, rotation needed: ${logInputPath}`);
        }

        // Prepare the final PNG buffer (apply rotation if needed)
        let sharpInstance = sharp(initialBuffer, {
            limitInputPixels: SHARP_PIXEL_LIMIT
        });
        if (needsRotation) {
            sharpInstance = sharpInstance.rotate(90);
        }
        const imageBufferForPdfLib = await sharpInstance.png().toBuffer();

        // Analyze margins (skip if margin is 0)
        const marginMm = options.marginMinMm ?? 3.5;
        try {
            if (marginMm > 0) {
                // Vertical margin is proportionally larger due to A5 aspect ratio
                const A5_W = 148.0, A5_H = 210.0;
                const verticalMm = marginMm * (A5_H / A5_W);
                marginResult = await analyzeMargins(imageBufferForPdfLib, { horizontal: marginMm, vertical: verticalMm });
            }
            if (marginResult.needsMargin) {
                sendLog(`[Transform Single] Content at edges, applying margin scale (${marginResult.scaleFactor.toFixed(3)}): ${logInputPath}`);
            }
        } catch (analysisError) {
            sendLog(`[Transform Single] WARN: Margin analysis failed: ${analysisError.message}, proceeding without margins`);
        }

        await imageToPdf(imageBufferForPdfLib, outputPath, {
            scaleFactor: marginResult.scaleFactor
        });
        sendLog(`[Transform Single] Successfully created PDF page: ${logOutputPath}`);

    } catch (error) {
        const lines = [
            `[Transform Single] ERROR processing file ${logInputPath}: ${error.message}`,
            `[Transform Single] FULL PATH: ${inputPath}`,
        ];

        if (error.message?.includes('exceeds pixel limit')) {
            lines.push(
                '[Transform Single] This image exceeds Sharp\'s pixel limits. The image is too large to process safely.',
                `[Transform Single] Consider reducing the image resolution or DPI setting (current: ${dpiValue}).`,
                '[Transform Single] Maximum recommended dimensions: ~32,000 x ~32,000 pixels.',
            );
        } else if (error.message?.includes('unsupported image format')) {
            lines.push('[Transform Single] This appears to be an image processing error. Check if the file is corrupted or in an unsupported format.');
        }

        sendLog(lines.join('\n'));
        throw error;
    }

    return marginResult;
}

/**
 * Creates a saddle-stitched booklet PDF from an input PDF.
 * Reorders pages and adds blank pages if necessary to make the page count a multiple of 4.
 * @param {string} inputPath - Path to the input PDF file.
 * @param {string} outputPath - Path to save the output booklet PDF.
 */
async function createSaddleStitchBooklet(inputPath, outputPath, sendLog = console.log) {
    const pdfBytes = fs.readFileSync(inputPath);
    const inputDoc = await PDFDocument.load(pdfBytes);
    const pageCount = inputDoc.getPageCount();

    if (pageCount === 0) {
        sendLog(`Skipping booklet creation for empty PDF: ${inputPath}`);
        return; // Skip if the PDF has no pages
    }

    let finalPageCount = pageCount;
    const pagesToAdd = (4 - (pageCount % 4)) % 4;
    finalPageCount += pagesToAdd;

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
    // Get dimensions from the first page
    const [firstInputPage] = inputDoc.getPages();
    const inputWidth = firstInputPage.getWidth();
    const inputHeight = firstInputPage.getHeight();

    // Determine output page size (e.g., landscape A3 for portrait A4 input)
    const outputPageWidth = inputWidth * 2;
    const outputPageHeight = inputHeight;
    // --- Logic using embedPage ---
    // 1. Pre-embed all necessary pages
    const embeddedPages = new Map();
    for (let i = 0; i < pageCount; i++) {
        if (await checkAborted()) {
            throw new Error('Booklet creation aborted during page embedding.');
        }
        const [embeddedPage] = await newPdfDoc.embedPdf(inputDoc, [i]);
        embeddedPages.set(i, embeddedPage);
    }

    // 2. Iterate through the required OUTPUT pages
    for (let i = 0; i < finalPageCount / 2; i++) {
        if (await checkAborted()) {
            throw new Error('Booklet creation aborted during page assembly.');
        }
        const leftSourceIndex = newIndices[i * 2];
        const rightSourceIndex = newIndices[i * 2 + 1];

        const outputPage = newPdfDoc.addPage([outputPageWidth, outputPageHeight]);

        // Draw left and right pages (skip if index is beyond pageCount — padding stays empty)
        function drawHalfPage(sourceIndex, xOffset) {
            if (sourceIndex >= pageCount) return;
            const embeddedPage = embeddedPages.get(sourceIndex);
            if (!embeddedPage) {
                throw new Error(`Failed to find pre-embedded page for source index ${sourceIndex}`);
            }
            outputPage.drawPage(embeddedPage, {
                x: xOffset, y: 0, width: inputWidth, height: inputHeight
            });
        }

        drawHalfPage(leftSourceIndex, 0, 'left');
        drawHalfPage(rightSourceIndex, inputWidth, 'right');
    }
    // --- End Logic ---

    // Save the new PDF
    const newPdfBytes = await newPdfDoc.save();
    fs.writeFileSync(outputPath, newPdfBytes);
    sendLog(`Booklet created: ${outputPath}`);
}

module.exports = {
    checkAborted,
    mergeStudentPDFs,
    processSingleTransformation,
    createSaddleStitchBooklet,
};
