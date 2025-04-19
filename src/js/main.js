const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync'); // Import sync parser
const sharp = require('sharp'); // Add sharp for image validation
const { PDFDocument } = require('pdf-lib'); // Add pdf-lib for PDF validation
const decodeHeic = require('heic-decode'); // Needed for HEIC

// Function to send logs to the renderer process UI
function sendLogToRenderer(message) {
    if (mainWindow && mainWindow.webContents) {
        // Optional: Add timestamp
        const timestamp = new Date().toLocaleTimeString(); 
        mainWindow.webContents.send('process-log', `[${timestamp}] ${message}`);
        // Also log to the main process console for debugging
        console.log(`[Main Log] ${message}`);
    } else {
        // Fallback log if window isn't ready/available
        console.log(`[Main Log - No Window] ${message}`);
    }
}

// Updated require to include new functions and error
const {
    mergeStudentPDFs,
    processSingleTransformation,  
    createSaddleStitchBooklet
} = require('./pdf-merger');

// --- MBZ Batch Creator Logic --- 
// const { createBatchAssignments } = require('../mbz-batch-creator'); // OLD IMPORT
const { modifyMoodleBackup } = require('../mbz-creator/lib/mbzCreator'); // NEW IMPORT
const { generateAssignmentDates } = require('../mbz-creator/lib/dateUtils'); // Might need this here
// --- End MBZ Batch Creator Logic --- 

// Keep track of the main window
let mainWindow = null;

// Global store for processed file info during transformation
let processedFileInfo = {}; // Format: { studentIdentifier: [{ pageName, originalFileName, studentInfo }, ...] }
// Global stores for summary statistics
let skippedFileLog = []; // Array of { studentIdentifier, pageDir, fileName, reason }
let errorFileLog = []; // Array of { studentIdentifier, pageDir, fileName, error }

// Store transformation context globally
let pendingTransformationData = null; 
let currentTransformationDpi = 300; 
let currentOutputDirectory = null;
let someNumberToEmailMap = {}; // Global map for CSV lookup

function createWindow() {


    const win = new BrowserWindow({
        width: 1200,
        height: 850,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    win.loadFile(path.join(__dirname, '../../index.html'));

    // Store reference
    mainWindow = win;

    // Check if config exists and send its content to renderer
    let configToSend = {}; // Initialize empty config object
    const defaultMoodlePattern = 'FULLNAMEWITHSPACES_SOMENUMBER_assignsubmission_file_';

    if (fs.existsSync(CONFIG_PATH)) {
        try {
            const loadedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
            configToSend = loadedConfig; // Start with loaded config
            // Ensure the default pattern is set if missing or empty
            if (!configToSend.foldernamePattern) {
                sendLogToRenderer(`Config loaded, but foldernamePattern missing. Setting default: ${defaultMoodlePattern}`);
                configToSend.foldernamePattern = defaultMoodlePattern;
            }
        } catch (err) {
            sendLogToRenderer(`Error loading config from ${CONFIG_PATH}: ${err.message}. Using default.`);
            // Fallback to default if loading fails
            configToSend = { 
                foldernamePattern: defaultMoodlePattern,
                // Include other potential default settings here if necessary
                dpi: 300, 
                minFileSizeKB: 1, 
                maxFileSizeMB: 20 
            };
        }
    } else {
        // Config file doesn't exist, create default object
        sendLogToRenderer(`Config file not found at ${CONFIG_PATH}. Using default.`);
        configToSend = { 
            foldernamePattern: defaultMoodlePattern, 
            // Include other default settings here
            dpi: 300, 
            minFileSizeKB: 1, 
            maxFileSizeMB: 20 
        };
        // Optionally save this default config immediately? Let's not for now.
        // try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(configToSend, null, 2)); } catch {} 
    }

    // Send the potentially modified config object once the window is ready
    win.webContents.on('did-finish-load', () => {
        if(mainWindow) mainWindow.webContents.send('load-config', configToSend);
    });

    win.on('closed', () => {
        mainWindow = null; // Clear reference on close
    });

    return win;
}


// --- Create Application Menu ---
const createMenu = (win) => {
    const template = [
        {
            label: 'File',
            submenu: [
                { role: 'quit' }
            ]
        },
        // Add standard Edit menu for Copy/Paste etc.
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'pasteAndMatchStyle' },
                { role: 'delete' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        }
        
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
};
// --- End Menu Creation ---

app.whenReady().then(() => {
    const mainWindow = createWindow();
    createMenu(mainWindow); // Call createMenu after window is created
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
       const mainWindow = createWindow();
       createMenu(mainWindow); // Also ensure menu is set if window is recreated
    }
});



// --- Determine Configuration Path --- 
function getConfigPath() {
    let configDir;
    // Use standard userData path for macOS (.app bundles)
    if (process.platform === 'darwin') {
        configDir = app.getPath('userData');
    } else {
        // For Windows/Linux, try to use a 'config' folder next to the executable
        try {
            // Path to the directory containing the executable
            const appDir = path.dirname(process.execPath);
            configDir = path.join(appDir, 'config');
            // Important: Check if we can actually write here.
            // This is a simple check; a more robust one might try creating the dir.
            fs.accessSync(appDir, fs.constants.W_OK);
            console.log(`Using portable config directory: ${configDir}`);
        } catch (err) {
            // Fallback to userData if portable path isn't writable or accessible
            console.warn(`Portable config path not writable/accessible (${err.message}), falling back to userData path.`);
            configDir = app.getPath('userData');
        }
    }

    // Ensure the chosen config directory exists
    if (!fs.existsSync(configDir)) {
        try {
            fs.mkdirSync(configDir, { recursive: true });
            console.log(`Created config directory: ${configDir}`);
        } catch (mkdirErr) {
            // Very unlikely fallback: if we can't create userData, log error and maybe use temp?
            console.error(`FATAL: Could not create config directory at ${configDir}. Error: ${mkdirErr.message}`);
            // As a last resort, could use temp dir, but config would be lost on exit.
            configDir = app.getPath('temp');
        }
    }

    return path.join(configDir, 'config.json');
}

const CONFIG_PATH = getConfigPath();
console.log(`Effective CONFIG_PATH: ${CONFIG_PATH}`); // Log the path being used
// --- End Configuration Path --- 

ipcMain.on('save-config', (event, config) => {
    const timestamp = Date.now(); // Add timestamp
    console.log(`[Main Process DEBUG ${timestamp}] Received 'save-config' event.`); // Log reception
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); // Added pretty-printing
        console.log(`[Main Process DEBUG ${timestamp}] Config successfully saved to ${CONFIG_PATH}`); // Log success
    } catch (error) {
        console.error(`[Main Process DEBUG ${timestamp}] Failed to save config to ${CONFIG_PATH}:`, error);
        // Optionally notify the renderer of the failure
    }
});



// Listen for directory selection from the renderer process
ipcMain.on('select-directory', async (event, type) => {
    let dialogOptions = {
        properties: ['openDirectory']
    };

    if (type === 'coverTemplateFile') { 
        dialogOptions = {
            properties: ['openFile'],
            filters: [{ name: 'Markdown Files', extensions: ['md'] }]
        };
    }

    const result = await dialog.showOpenDialog(dialogOptions);

    if (!result.canceled && result.filePaths.length > 0) {
        event.sender.send('directory-selected', type, result.filePaths[0]);
    }
});


// Helper function to parse folder name based on pattern
function parseFolderName(folderName, pattern) {
    const result = {
        primaryIdentifier: folderName, 
        firstName: '',
        lastName: '',
        studentNumber: '',
        username: '',
        fullName: folderName,
        someNumber: null // Added to store Moodle ID number
    };

    if (!pattern || !folderName) {
        console.warn(`No pattern or folderName provided for parsing. FolderName: ${folderName}`);
        // Attempt basic split for lastname as a last resort
        const parts = folderName.trim().split(/\s+|_/);
        result.lastName = parts.pop() || folderName;
        result.firstName = parts.join(' ') || '';
        return result;
    }

    console.log(`Parsing folder '${folderName}' with pattern '${pattern}'`);

    // --- Detect Separator --- 
    let separator = null;
    if (pattern.includes('_') && !pattern.startsWith('FULLNAMEWITHSPACES')) { // Prioritize _ unless it's the Moodle pattern
        separator = '_';
    } else if (pattern.includes('-')) {
        separator = '-';
    }
    console.log(`Detected separator from pattern: '${separator}'`);
    // --- End Detect --- 

    // Special Moodle case (still assumes _ before suffix, but less reliant on internal _)
    const moodleSuffix = '_assignsubmission_file_';
    if (pattern.startsWith('FULLNAMEWITHSPACES') && folderName.includes(moodleSuffix)) { 
        const baseName = folderName.substring(0, folderName.lastIndexOf(moodleSuffix));
        const nameAndNumber = separator ? baseName.split(separator) : baseName.split('_'); 
        
        if (nameAndNumber.length >= 2) {
            result.fullName = nameAndNumber.slice(0, -1).join(separator || '_');
            const nameComponents = result.fullName.trim().split(/\s+/);
            result.lastName = nameComponents.pop() || result.fullName;
            result.firstName = nameComponents.join(' ') || '';
            result.primaryIdentifier = result.fullName;
            // Extract the number part
            result.someNumber = nameAndNumber[nameAndNumber.length - 1]; 
            console.log('Parsed using Moodle pattern logic:', result);
            return result;
        } else {
             console.warn(`Moodle pattern detected, but could not split base name '${baseName}' correctly.`);
             // Proceed to general parsing as fallback
        }
    }

    // General parsing using the detected separator
    if (!separator) {
        console.warn(`Could not detect a clear separator ('_' or '-') in pattern '${pattern}'. Attempting basic parsing.`);
        // Use basic split as fallback if no separator
        const parts = folderName.trim().split(/\s+|_/); 
        result.lastName = parts.pop() || folderName;
        result.firstName = parts.join(' ') || '';
        result.fullName = `${result.firstName} ${result.lastName}`.trim();
        // Set primaryIdentifier based on best available info
        if (result.fullName) {
             result.primaryIdentifier = result.fullName;
        } // else it defaults to original folderName
        console.log('Parsed using basic fallback:', result);
        return result;
    }

    const patternParts = pattern.split(separator);
    const folderParts = folderName.split(separator);

    if (patternParts.length !== folderParts.length) {
        console.warn(`Folder name '${folderName}' does not match pattern structure '${pattern}'. Part count mismatch.`);
        // Attempt basic split for lastname as a last resort
        const parts = folderName.trim().split(/\s+|_/);
        result.lastName = parts.pop() || folderName;
        result.firstName = parts.join(' ') || '';
        result.fullName = `${result.firstName} ${result.lastName}`.trim();
        if (result.fullName) {
            result.primaryIdentifier = result.fullName;
        }
        return result;
    }

    for (let i = 0; i < patternParts.length; i++) {
        const key = patternParts[i].toUpperCase();
        const value = folderParts[i];

        switch (key) {
            case 'FIRSTNAME':
                result.firstName = value;
                break;
            case 'LASTNAME':
                result.lastName = value;
                break;
            case 'FULLNAMEWITHSPACES': // Note: This case shouldn't be reached if Moodle logic ran
                result.fullName = value; 
                // Attempt to derive first/last name from full name if possible
                const nameComponents = value.trim().split(/\s+/);
                result.lastName = nameComponents.pop() || value;
                result.firstName = nameComponents.join(' ') || '';
                break;
            case 'USERNAME':
                result.username = value;
                break;
            case 'STUDENTNUMBER':
                result.studentNumber = value;
                break;
            case 'SOMENUMBER': // Handle explicit SOMENUMBER placeholder
                result.someNumber = value;
                break;
            // Ignore other parts like 'SOMENUMBER'
        }
    }

    // Determine primary identifier based on priority
    if (result.studentNumber) {
        result.primaryIdentifier = result.studentNumber;
    } else if (result.username) {
        result.primaryIdentifier = result.username;
    } else {
        if (!result.fullName && (result.firstName || result.lastName)) {
             result.fullName = `${result.firstName} ${result.lastName}`.trim();
        }
        result.primaryIdentifier = result.fullName || folderName;
    }
    
    // Ensure fullName is set (logic remains the same)
    if (!result.fullName && (result.firstName || result.lastName)) {
         result.fullName = `${result.firstName} ${result.lastName}`.trim();
    }

    console.log('Parsed using general pattern:', result);
    return result;
}

// Extract CSV parsing to a separate function that can be reused
async function parseCSVsInDirectory(mainDirectory) {
    const emailMappings = {};
    const pagesWithCSV = new Set(); // Track which pages have CSV files
    const pagesWithoutCSV = new Set(); // Track which pages don't have CSV files
    
    console.log("Starting CSV parsing process...");

    // Get page directories
    const pageDirs = fs.readdirSync(mainDirectory).filter(item => {
        const itemPath = path.join(mainDirectory, item);
        return fs.statSync(itemPath).isDirectory();
    });
    
    if (pageDirs.length === 0) {
        console.warn('No page directories found for CSV parsing.');
        return { emailMappings, pagesWithCSV, pagesWithoutCSV, allPages: new Set() };
    }

    for (const pageDir of pageDirs) {
        const pageDirPath = path.join(mainDirectory, pageDir);
        console.log(`Scanning page directory for CSV files: ${pageDirPath}`);
        try {
            // List all files in the directory for debugging
            const files = fs.readdirSync(pageDirPath);
            console.log(`Files in ${pageDir}: ${files.join(', ')}`);
            
            // Look for any file ending with .csv (case insensitive)
            const csvFiles = files.filter(file => {
                const lcFile = file.toLowerCase().trim();
                const isCSV = lcFile.endsWith('.csv');
                console.log(`  ${file}: is CSV? ${isCSV}`);
                return isCSV;
            });
            
            if (csvFiles.length > 0) {
                console.log(`Found ${csvFiles.length} CSV file(s) in ${pageDir}: ${csvFiles.join(', ')}`);
                pagesWithCSV.add(pageDir); // Record that this page has CSV files
                
                // Use the first CSV file found
                const csvFile = csvFiles[0];
                
                const csvPath = path.join(pageDirPath, csvFile);
                console.log(`Parsing CSV: ${csvPath}`);
                try {
                    const csvContent = fs.readFileSync(csvPath, 'utf-8');
                    console.log(`CSV file size: ${csvContent.length} bytes`);
                    console.log(`CSV first 100 chars: ${csvContent.substring(0, 100).replace(/\n/g, '\\n')}...`);
                    
                    const records = parse(csvContent, {
                        columns: true, 
                        skip_empty_lines: true,
                        trim: true,
                        relax_column_count: true // Be more lenient with CSV format
                    });
                    
                    console.log(`Parsed ${records.length} records from CSV`);
                    if (records.length > 0) {
                        console.log(`Available headers: ${Object.keys(records[0] || {}).join(', ')}`);
                    }
                    
                    // Find header names flexibly (case-insensitive, trim)
                    const headers = Object.keys(records[0] || {}).map(h => h.trim().toLowerCase());
                    const idHeader = headers.find(h => h.includes('id'));
                    const emailHeader = headers.find(h => 
                        h.includes('email') || 
                        h.includes('e-mail') || 
                        h.includes('mail-adresse') || 
                        h === 'e-mail-adresse'
                    );
                    
                    console.log(`Found headers - ID: ${idHeader || 'NOT FOUND'}, Email: ${emailHeader || 'NOT FOUND'}`);

                    if (!idHeader || !emailHeader) {
                        console.warn(`CSV ${csvFile} in ${pageDir} is missing required headers (ID-like and Email-like). Skipping.`);
                        // Even though we found a CSV, it's not usable, so move this page to the without list
                        pagesWithCSV.delete(pageDir);
                        pagesWithoutCSV.add(pageDir);
                        continue;
                    }
                    
                    let mappingsFound = 0;
                    records.forEach(record => {
                        const rawId = record[Object.keys(record).find(k => k.trim().toLowerCase() === idHeader)];
                        const email = record[Object.keys(record).find(k => k.trim().toLowerCase() === emailHeader)];
                        if (rawId && email) {
                            // Extract any numeric sequence from the ID
                            const match = String(rawId).match(/\d+/);
                            if (match) {
                                const someNumber = match[0];
                                if (!emailMappings[someNumber]) { // Avoid overwriting from different pages if ID reused
                                    emailMappings[someNumber] = email;
                                    mappingsFound++;
                                }
                            }
                        }
                    });
                    console.log(`Added ${mappingsFound} new email mappings from ${csvFile}`);
                    console.log(`Total email mappings: ${Object.keys(emailMappings).length}`);
                } catch (csvParseErr) {
                    console.error(`Error parsing CSV file ${csvPath}:`, csvParseErr);
                    // CSV parsing failed, so this page doesn't have usable CSV
                    pagesWithCSV.delete(pageDir);
                    pagesWithoutCSV.add(pageDir);
                }
            } else {
                console.log(`No CSV files found in ${pageDir}`);
                pagesWithoutCSV.add(pageDir);
            }
        } catch (err) {
            console.error(`Error processing directory ${pageDir}:`, err);
            pagesWithoutCSV.add(pageDir);
            // Continue processing other directories even if one CSV fails
        }
    }
    console.log(`Final email mapping count: ${Object.keys(emailMappings).length}`);
    console.log(`Pages with CSV: ${Array.from(pagesWithCSV).join(', ')}`);
    console.log(`Pages without CSV: ${Array.from(pagesWithoutCSV).join(', ')}`);
    console.log("Finished scanning all page directories for CSVs.");
    
    // Return both the mappings and information about CSV coverage
    return { 
        emailMappings, 
        pagesWithCSV, 
        pagesWithoutCSV, 
        allPages: new Set([...pagesWithCSV, ...pagesWithoutCSV]) 
    };
}

// Function to prepare transformations and handle ambiguities
async function prepareTransformations(mainDirectory, outputDirectory, folderPattern) {
    sendLogToRenderer("Preparing transformations...");

    // Load config to get filesize limits
    let config = {};
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (err) {
        sendLogToRenderer("WARN: Could not load config for filesize limits, using defaults.");
    }
    const minSizeBytes = (config.minFileSizeKB || 5) * 1024;
    const maxSizeBytes = (config.maxFileSizeMB || 20) * 1024 * 1024; // Default 20MB
    sendLogToRenderer(`Filesize limits: Min=${minSizeBytes} bytes, Max=${maxSizeBytes} bytes`);
    
    // Use the shared CSV parsing function
    const csvResult = await parseCSVsInDirectory(mainDirectory); // Assign the whole result object
    someNumberToEmailMap = csvResult.emailMappings; // Extract the email mappings
    sendLogToRenderer(`Loaded ${Object.keys(someNumberToEmailMap).length} email mappings from CSVs (Pages with CSV: ${csvResult.pagesWithCSV.size}, without: ${csvResult.pagesWithoutCSV.size})`);
    
    const transformationTasks = [];
    const ambiguities = [];

    if (!fs.existsSync(mainDirectory)) {
        throw new Error(`Input directory does not exist: ${mainDirectory}`);
    }
    
    if (!fs.existsSync(outputDirectory)) {
        sendLogToRenderer(`Creating output directory: ${outputDirectory}`);
        fs.mkdirSync(outputDirectory, { recursive: true });
    }
    
    const pageDirs = fs.readdirSync(mainDirectory).filter(item => {
        const itemPath = path.join(mainDirectory, item);
        return fs.statSync(itemPath).isDirectory();
    });
    
    sendLogToRenderer(`Found ${pageDirs.length} page directories: ${pageDirs.join(', ')}`);
    if (pageDirs.length === 0) throw new Error('No page directories found.');
    
    // Iterate through page directories to find student folders and create tasks
    for (const pageDir of pageDirs) {
        const pageDirPath = path.join(mainDirectory, pageDir);
        const studentFolders = fs.readdirSync(pageDirPath).filter(item => {
            const itemPath = path.join(pageDirPath, item);
            return fs.statSync(itemPath).isDirectory();
        });
        
        for (const studentFolder of studentFolders) {
            const studentFolderPath = path.join(pageDirPath, studentFolder);
            const potentialFiles = fs.readdirSync(studentFolderPath);
            let validatedFiles = []; // Store files that pass all checks
            const allowedExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.heic'];
            const parsedStudentInfo = parseFolderName(studentFolder, folderPattern); // Parse student info once
            const studentIdentifier = parsedStudentInfo.primaryIdentifier;

            // --- Check for Unexpected File Types FIRST ---
            for (const file of potentialFiles) {
                const filePath = path.join(studentFolderPath, file);
                // Silently skip .DS_Store files
                if (path.basename(filePath) === '.DS_Store') continue;
                
                try {
                    // Check if it's a file, not a directory
                    if (!fs.statSync(filePath).isFile()) continue;
                    
                    const ext = path.extname(file).toLowerCase();
                    if (!allowedExtensions.includes(ext)) {
                        const relativePath = path.relative(mainDirectory, filePath);
                        const warnMsg = `WARN: Unexpected file type found and ignored: ${relativePath}`;
                        sendLogToRenderer(warnMsg);
                        // Log skip
                        skippedFileLog.push({ studentIdentifier, pageDir, fileName: file, reason: 'Unsupported Type' });
                        if (mainWindow) mainWindow.webContents.send('error-log', warnMsg);
                    }
                } catch (statErr) {
                    // Log error if we can't even stat the file
                    const statErrorMsg = `WARN: Could not read item info: ${path.relative(mainDirectory, filePath)} - Error: ${statErr.message}`;
                    sendLogToRenderer(statErrorMsg);
                    if (mainWindow) mainWindow.webContents.send('error-log', statErrorMsg);
                }
            }
            // --- End Unexpected File Type Check ---

            // Filter files by extension, integrity, and size limits
            for (const file of potentialFiles) {
                const filePath = path.join(studentFolderPath, file);
                const ext = path.extname(file).toLowerCase();
                // const allowedExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.heic']; // Defined above now

                if (!allowedExtensions.includes(ext)) continue; // Skip disallowed extensions (again, belt & suspenders)

                let isValid = false;
                let fileBuffer;
                try {
                    fileBuffer = fs.readFileSync(filePath);
                    // --- Integrity Check --- 
                    if (ext === '.pdf') {
                        await PDFDocument.load(fileBuffer); // Throws on error
                        isValid = true;
                    } else if (ext === '.heic') {
                        const { data, width, height } = await decodeHeic({ buffer: fileBuffer });
                        // Check metadata of the decoded PNG buffer
                        await sharp(data, { raw: { width, height, channels: 4 } }).metadata(); 
                        isValid = true;
                    } else { // Other images (png, jpg, jpeg)
                        await sharp(fileBuffer).metadata(); // Throws on error
                        isValid = true;
                    }
                } catch (validationError) {
                    const relativePath = path.relative(mainDirectory, filePath);
                    const errorMsg = `Skipping file (Invalid/Corrupt): ${relativePath} - Error: ${validationError.message}`;
                    sendLogToRenderer(errorMsg);
                    // Log skip
                    skippedFileLog.push({ studentIdentifier, pageDir, fileName: file, reason: 'Invalid/Corrupt' });
                    if (mainWindow) mainWindow.webContents.send('error-log', errorMsg);
                    isValid = false;
                }

                if (!isValid) continue; // Skip if integrity check failed

                // --- Size Check --- 
                try {
                    // We already have the buffer, use its length for size
                    const fileSize = fileBuffer.length; 
                    if (fileSize >= minSizeBytes && fileSize <= maxSizeBytes) {
                        validatedFiles.push(file); // Keep file if valid and within limits
                    } else {
                        const sizeKB = (fileSize / 1024).toFixed(2);
                        const relativePath = path.relative(mainDirectory, filePath);
                        const sizeErrorMsg = `Skipping file (Size Limit): ${relativePath} (${sizeKB} KB)`;
                        sendLogToRenderer(sizeErrorMsg);
                        // Log skip
                        skippedFileLog.push({ studentIdentifier, pageDir, fileName: file, reason: 'Size Limit' });
                        if (mainWindow) mainWindow.webContents.send('error-log', sizeErrorMsg);
                    }
                } catch (err) { // Should not happen if buffer read worked, but safety check
                    const relativePath = path.relative(mainDirectory, filePath);
                    const statErrorMsg = `Error checking size for file ${relativePath}: ${err.message}`;
                    sendLogToRenderer(statErrorMsg);
                    if (mainWindow) mainWindow.webContents.send('error-log', statErrorMsg);
                    // Log skip (though this indicates a read error, treat as skip)
                    skippedFileLog.push({ studentIdentifier, pageDir, fileName: file, reason: 'Read Error' });
                }
            } // End loop through potential files

            // Use the fully validated list now
            const finalValidFiles = validatedFiles;

            if (finalValidFiles.length === 0) {
                const relativeFolderPath = path.relative(mainDirectory, studentFolderPath);
                const skipMsg = `INFO: No valid files found in ${relativeFolderPath}, skipping folder.`;
                sendLogToRenderer(skipMsg);
                // if (mainWindow) mainWindow.webContents.send('error-log', skipMsg); // Maybe too noisy for UI log
                continue;
            }
            
            // --- Proceed with ambiguity check / task creation using finalValidFiles --- 
            const studentOutputDir = path.join(outputDirectory, 'pages', studentIdentifier);
            if (!fs.existsSync(studentOutputDir)) {
                fs.mkdirSync(studentOutputDir, { recursive: true });
            }
            const outputFilePath = path.join(studentOutputDir, `${pageDir}.pdf`);
            
            if (finalValidFiles.length === 1) {
                transformationTasks.push({
                    inputPath: path.join(studentFolderPath, finalValidFiles[0]),
                    outputPath: outputFilePath,
                    pageName: pageDir,
                    originalFileName: finalValidFiles[0],
                    studentInfo: parsedStudentInfo 
                });
            } else { // finalValidFiles.length > 1
                ambiguities.push({
                    folderPath: studentFolderPath,
                    files: finalValidFiles, // Use the validated list
                    context: `Student: ${studentFolder}, Page: ${pageDir}`
                });
            }
        } // End loop through student folders
    } // End loop through page directories
    
    sendLogToRenderer(`Preparation complete. Tasks: ${transformationTasks.length}, Ambiguities: ${ambiguities.length}. Email map size: ${Object.keys(someNumberToEmailMap).length}`);
    return { tasks: transformationTasks, ambiguities };
}


// --- Helper Functions for start-transformation ---

/**
 * Attempts to resolve Moodle name collisions using email mappings.
 * Modifies the tasks array in place.
 * @param {Array} tasks - The list of transformation tasks.
 * @param {Object} emailMap - The map of someNumber to email addresses.
 * @param {string} outputDirectory - The base output directory.
 */
function resolveMoodleCollisions(tasks, emailMap, outputDirectory) {
    sendLogToRenderer("Attempting Moodle collision resolution using emails...");
    const identifierGroups = tasks.reduce((acc, task) => {
        const id = task.studentInfo.primaryIdentifier;
        if (!acc[id]) acc[id] = [];
        acc[id].push(task);
        return acc;
    }, {});

    let resolvedCollisions = 0;
    for (const identifier in identifierGroups) {
        if (identifierGroups[identifier].length > 1) { // Potential collision
            sendLogToRenderer(`Potential collision for identifier: ${identifier}`);
            let canResolveAll = true;
            let allEmails = new Set();

            for (const task of identifierGroups[identifier]) {
                const someNum = task.studentInfo.someNumber;
                const email = someNum ? emailMap[someNum] : null;
                if (email) {
                    allEmails.add(email);
                    task.studentInfo.email = email; // Store email for potential use
                } else {
                    sendLogToRenderer(`Cannot resolve for ${identifier}: Task for ${task.originalFileName} missing someNumber or email mapping.`);
                    canResolveAll = false;
                    break; // Cannot resolve this group
                }
            }

            // If all tasks in the group had a mapped email AND there are multiple unique emails
            if (canResolveAll && allEmails.size > 1) {
                 sendLogToRenderer(`Resolving collision for ${identifier} using emails.`);
                 identifierGroups[identifier].forEach(task => {
                     task.studentInfo.primaryIdentifier = task.studentInfo.email;
                     // Also update the outputPath to reflect the new identifier
                     task.outputPath = path.join(outputDirectory, 'pages', task.studentInfo.primaryIdentifier, `${task.pageName}.pdf`);
                     sendLogToRenderer(`  Updated task for ${task.originalFileName} -> ID: ${task.studentInfo.primaryIdentifier}, Path: ${task.outputPath}`);
                 });
                 resolvedCollisions++;
            } else if (canResolveAll && allEmails.size <= 1) {
                // All map to the same email or only one email found (no actual collision)
                sendLogToRenderer(`Collision group for ${identifier} resolved to single email or no conflict. No change needed.`);
            } else {
                sendLogToRenderer(`Could not fully resolve collision for ${identifier} using emails.`);
            }
        }
    }
     if (resolvedCollisions > 0) {
         sendLogToRenderer(`Automatically resolved ${resolvedCollisions} name collisions using emails.`);
     }
    // Note: This function modifies 'tasks' directly.
}

/**
 * Performs the final V7 collision check based on origin keys.
 * Throws an error if unresolvable collisions are found.
 * @param {Array} tasks - The list of transformation tasks (potentially updated by Moodle resolution).
 * @param {boolean} isMoodleMode - Flag indicating if Moodle pattern is used.
 */
function performFinalCollisionCheck(tasks, isMoodleMode) {
    sendLogToRenderer("Performing final collision check V7...");
    const finalIdentifierGroups = tasks.reduce((acc, task) => {
        const finalId = task.studentInfo.primaryIdentifier;
        if (!acc[finalId]) {
            acc[finalId] = {
                originKeys: new Set(),
                taskExamples: [],
                pageFolders: new Set(),
                tasksByPageFolder: {}
            };
        }
        
        let originKey;
        const folderName = path.basename(path.dirname(task.inputPath));
        const pageFolder = path.basename(path.dirname(path.dirname(task.inputPath)));
        acc[finalId].pageFolders.add(pageFolder);
        
        // Track tasks by page folder to detect duplicates within the same page folder
        if (!acc[finalId].tasksByPageFolder[pageFolder]) {
            acc[finalId].tasksByPageFolder[pageFolder] = [];
        }
        acc[finalId].tasksByPageFolder[pageFolder].push({
            filename: path.basename(task.inputPath),
            folderName: folderName
        });
        
        if (isMoodleMode) {
            const moodleSuffix = '_assignsubmission_file_';
            if (folderName.includes(moodleSuffix)) {
                originKey = task.studentInfo.fullName;
            } else {
                originKey = folderName;
            }
        } else {
            originKey = folderName;
        }
        
        acc[finalId].originKeys.add(originKey);
        
        if (acc[finalId].taskExamples.length < 3) {
             acc[finalId].taskExamples.push(`${path.basename(task.inputPath)} (from ${pageFolder})`);
        }
        return acc;
    }, {});

    const finalCollisionsData = [];
    for (const identifier in finalIdentifierGroups) {
        const group = finalIdentifierGroups[identifier];
        
        // Check for multiple entries within the same page folder (new collision detection)
        let hasDuplicatesInSamePageFolder = false;
        let duplicateDetails = [];
        
        for (const pageFolder in group.tasksByPageFolder) {
            if (group.tasksByPageFolder[pageFolder].length > 1) {
                hasDuplicatesInSamePageFolder = true;
                duplicateDetails.push(`${pageFolder} (${group.tasksByPageFolder[pageFolder].length} submissions)`);
            }
        }
        
        if (hasDuplicatesInSamePageFolder) {
            sendLogToRenderer(`Collision Error: Identifier '${identifier}' has multiple submissions in the same page folder(s): ${duplicateDetails.join(', ')}`);
            finalCollisionsData.push(`${identifier} (multiple submissions in: ${duplicateDetails.join(', ')})`);
        }
        else if (group.originKeys.size > 1) {
             sendLogToRenderer(`Final Collision Error V7: Identifier '${identifier}' associated with multiple distinct origins: ${Array.from(group.originKeys).join(', ')}. Example files involved: ${group.taskExamples.join(', ')}`);
             finalCollisionsData.push(`${identifier} (from origins: ${Array.from(group.originKeys).join(', ')})`);
        } else if (group.pageFolders.size > 1) {
             sendLogToRenderer(`Student '${identifier}' has submissions in multiple page folders: ${Array.from(group.pageFolders).join(', ')}`);
        }
    }

    if (finalCollisionsData.length > 0) {
        const collisionDetails = finalCollisionsData.join('; ');
        sendLogToRenderer(`Final check V7 failed: Unresolvable collisions detected: ${collisionDetails}`);
        throw new Error(`FinalCollisionError: Unresolvable collisions found: ${collisionDetails}. Please rename input folders manually or provide/correct CSVs.`);
    }
    sendLogToRenderer("Final collision check V7 passed.");
}

/**
 * Processes tasks directly when no ambiguities are present.
 * Includes progress updates and saving processed info.
 * @param {Array} tasks - The list of transformation tasks.
 * @param {string} outputDirectory - The base output directory.
 * @param {number} dpi - The DPI setting for transformations.
 * @returns {string} Success message.
 * @throws {Error} If processing completes with errors.
 */
async function processTasksDirectly(tasks, outputDirectory, dpi) {
    sendLogToRenderer("IPC: No ambiguities or collisions. Processing tasks directly.");
    let successCount = 0;
    let errorCount = 0;
    const totalTasks = tasks.length;

    for (let i = 0; i < totalTasks; i++) {
        const task = tasks[i];
        const taskOutputDir = path.dirname(task.outputPath);
        if (!fs.existsSync(taskOutputDir)) {
            sendLogToRenderer(`Creating task output directory: ${taskOutputDir}`);
            fs.mkdirSync(taskOutputDir, { recursive: true });
        }

        if (mainWindow) {
            const progress = Math.round(((i + 1) / totalTasks) * 100);
            mainWindow.webContents.send('transformation-progress', {
                current: i + 1,
                total: totalTasks,
                percentage: progress,
                fileName: path.basename(task.inputPath) 
            });
        }
        
        try {
            // Pass sendLogToRenderer to the transformation function
            await processSingleTransformation(task.inputPath, task.outputPath, dpi, sendLogToRenderer);
            successCount++;
            const studentIdentifier = task.studentInfo?.primaryIdentifier || path.basename(taskOutputDir);
            if (!processedFileInfo[studentIdentifier]) processedFileInfo[studentIdentifier] = [];
            processedFileInfo[studentIdentifier].push({ 
                pageName: task.pageName, 
                originalFileName: task.originalFileName,
                studentInfo: task.studentInfo
            });
        } catch (processingError) {
            errorCount++;
            const studentIdentifier = task.studentInfo?.primaryIdentifier || path.basename(taskOutputDir);
            // Log error details
            errorFileLog.push({
                studentIdentifier,
                pageDir: task.pageName,
                fileName: path.basename(task.inputPath),
                error: processingError.message
            });

            // Use relative path for input file in error message
            const relativeInputPath = task.inputPath ? path.relative(currentOutputDirectory, task.inputPath) : '[unknown input file]'; // Use currentOutputDirectory as base? Or should we pass mainDirectory?
            // Let's assume we want path relative to the *input* directory for clarity. Need mainDirectory here.
            // NOTE: processTasksDirectly needs access to mainDirectory to make this log useful.
            // For now, log the full path or just the basename
            const errorMsg = `Error transforming ${path.basename(task.inputPath)}: ${processingError.message}`;
            sendLogToRenderer(errorMsg); // Send to process log
            if (mainWindow) mainWindow.webContents.send('error-log', errorMsg);
            // Create placeholder error file
            try {
                const errorFilePath = task.outputPath.replace(/\.pdf$/, '_error.txt'); 
                fs.writeFileSync(errorFilePath, `Failed to process: ${path.basename(task.inputPath)}\nError: ${processingError.message}\n${processingError.stack || ''}`);
                sendLogToRenderer(`Created error placeholder: ${errorFilePath}`);
            } catch (writeError) {
                // Use relative path for output file in error message
                const relativeOutputPath = task.outputPath ? path.relative(currentOutputDirectory, task.outputPath) : '[unknown output file]';
                const writeErrorMsg = `Failed to write error placeholder for ${relativeOutputPath}: ${writeError.message}`;
                sendLogToRenderer(writeErrorMsg); // Send to process log
                 if (mainWindow) mainWindow.webContents.send('error-log', `ERROR: ${writeErrorMsg}`);
            }
        }
    }

    await saveProcessedFileInfo(outputDirectory);
    sendLogToRenderer(`IPC: Transformation processing complete. Success: ${successCount}, Errors: ${errorCount}`);
    
    if (errorCount > 0) {
        throw new Error(`Transformation completed with ${errorCount} error(s).`);
    } else {
        return `Transformation completed successfully for ${successCount} file(s).`;
    }
}

// --- End Helper Functions ---

ipcMain.handle('start-transformation', async (event, mainDirectory, outputDirectory, dpi) => {
    sendLogToRenderer("IPC: Received start-transformation");
    // Reset global state
    pendingTransformationData = null; 
    currentTransformationDpi = dpi;   
    currentOutputDirectory = outputDirectory;
    processedFileInfo = {}; 
    skippedFileLog = []; // Clear logs for new run
    errorFileLog = [];   // Clear logs for new run

    let config = {};
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (err) {
        sendLogToRenderer("WARN: Could not load config for transformation, using defaults.");
    }
    // Apply default Moodle pattern if not found in config
    const folderPattern = config.foldernamePattern || 'FULLNAMEWITHSPACES_SOMENUMBER_assignsubmission_file_'; 
    const isMoodleMode = folderPattern?.startsWith('FULLNAMEWITHSPACES');
    sendLogToRenderer(`Using folder pattern: ${folderPattern}, Moodle Mode: ${isMoodleMode}`);

    try {
        // 1. Prepare initial tasks and identify ambiguities
        let { tasks, ambiguities } = await prepareTransformations(mainDirectory, outputDirectory, folderPattern);
        sendLogToRenderer(`IPC: Initial preparation complete. Tasks: ${tasks.length}, Ambiguities: ${ambiguities.length}. Email map size: ${Object.keys(someNumberToEmailMap).length}`);

        // 2. Attempt Moodle Collision Resolution (modifies tasks in place)
        if (isMoodleMode && tasks.length > 0) {
            resolveMoodleCollisions(tasks, someNumberToEmailMap, outputDirectory);
        }
        
        // 3. Perform Final Collision Check (throws error if issues found)
        performFinalCollisionCheck(tasks, isMoodleMode);

        // 4. Handle Ambiguities or Process Directly
        if (ambiguities.length > 0) {
            // Store data for later resolution
            pendingTransformationData = { unambiguousTasks: tasks, ambiguities, outputDirectory }; 
            sendLogToRenderer("IPC: Ambiguities found. Requesting resolution from renderer.");
            if (mainWindow) {
                mainWindow.webContents.send('request-ambiguity-resolution', ambiguities);
            }
            // Need to generate summary AFTER ambiguity is resolved
            // Placeholder: Summary will be generated in resolve-ambiguity handler later
            return { status: 'ambiguity_detected', message: 'Ambiguity detected. Please resolve conflicts.' };
        } else {
            // Process tasks directly (includes saving processed info)
            const resultMessage = await processTasksDirectly(tasks, outputDirectory, dpi);
            
            // Generate and send summary log after direct processing
            await generateAndSendSummary(outputDirectory);
            
            // Generate HTML summary report
            await generateSummaryHtml(outputDirectory);

            // Clear global state after successful direct processing
            pendingTransformationData = null; 
            currentOutputDirectory = null;
            return resultMessage;
        }

    } catch (error) {
        sendLogToRenderer("IPC: Error during transformation start:");
        // Clear potentially inconsistent state on error
        pendingTransformationData = null; 
        currentOutputDirectory = null;
        processedFileInfo = {}; 
        // Also clear summary logs on error
        skippedFileLog = [];
        errorFileLog = [];
        throw error; // Re-throw to renderer
    }
});

ipcMain.handle('resolve-ambiguity', async (event, selectedIdentifiers) => {
    sendLogToRenderer("IPC: Received resolve-ambiguity with selected files:");
    console.log("Selected choices:", selectedIdentifiers); // Log the raw choices received
    
    if (!pendingTransformationData) {
        throw new Error("No pending transformation data found for ambiguity resolution.");
    }
    
    // Make sure we have access to necessary info like output dir and pattern
    if (!pendingTransformationData.outputDirectory || !currentTransformationDpi) { 
        throw new Error("Missing output directory or DPI setting in pending data.");
    }
    
    // Load folder pattern again, it's needed to parse student info
    let config = {};
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (err) {
        sendLogToRenderer("WARN: Could not load config to get folder pattern during ambiguity resolution.");
        // Potentially throw an error here if pattern is crucial?
    }
    // Apply default Moodle pattern if not found in config
    const folderPattern = config.foldernamePattern || 'FULLNAMEWITHSPACES_SOMENUMBER_assignsubmission_file_';

    // Start with the tasks that were already unambiguous
    const tasksToProcess = [...pendingTransformationData.unambiguousTasks];
    let resolvedCount = 0;

    // Process the user's selections to create new tasks
    for (const folderPath in selectedIdentifiers) {
        const selectedFileName = selectedIdentifiers[folderPath];
        sendLogToRenderer(`  Resolving ambiguity for folder: ${path.basename(folderPath)} with file: ${selectedFileName}`);
        
        // Find the corresponding ambiguity object (we don't strictly need it if we have the path)
        // const ambiguity = pendingTransformationData.ambiguities.find(a => a.folderPath === folderPath);
        // if (!ambiguity) {
        //     sendLogToRenderer(`WARN: Could not find ambiguity data for folder path ${folderPath}. Skipping.`);
        //     continue;
        // }

        try {
            // Reconstruct necessary info to create the task
            const studentFolder = path.basename(folderPath); // e.g., Max_Mustermann_12345...
            const pageDir = path.basename(path.dirname(folderPath)); // e.g., Seite 1
            
            // Parse student info from the original ambiguous folder name
            const parsedStudentInfo = parseFolderName(studentFolder, folderPattern); 
            const studentIdentifier = parsedStudentInfo.primaryIdentifier; // Get the identifier (name, email, etc.)
            
            // Determine the correct output path
            const outputFilePath = path.join(pendingTransformationData.outputDirectory, 'pages', studentIdentifier, `${pageDir}.pdf`);
            
            // Create the new task object
            const resolvedTask = {
                inputPath: path.join(folderPath, selectedFileName),
                outputPath: outputFilePath,
                pageName: pageDir,
                originalFileName: selectedFileName, // The file chosen by the user
                studentInfo: parsedStudentInfo 
            };
            
            tasksToProcess.push(resolvedTask);
            resolvedCount++;
            sendLogToRenderer(`    -> Created task: ${resolvedTask.inputPath} -> ${resolvedTask.outputPath}`);
        } catch (taskCreationError) {
             sendLogToRenderer(`ERROR creating task for resolved ambiguity in ${folderPath}: ${taskCreationError.message}. Skipping this resolution.`);
        }
    }

    sendLogToRenderer(`Added ${resolvedCount} tasks from resolved ambiguities. Total tasks to process: ${tasksToProcess.length}`);
    
    // Process the combined list of unambiguous and resolved tasks
    try {
        const resultMessage = await processTasksDirectly(tasksToProcess, pendingTransformationData.outputDirectory, currentTransformationDpi);

        // Generate and send summary log AFTER ambiguity resolution and processing
        await generateAndSendSummary(pendingTransformationData.outputDirectory);
        
        // Generate HTML summary report
        await generateSummaryHtml(pendingTransformationData.outputDirectory);
        
        // Clear global state
        pendingTransformationData = null; 
        currentOutputDirectory = null;
        processedFileInfo = {}; // Clear processed info as well
        skippedFileLog = [];    // Clear summary logs
        errorFileLog = [];
        
        return resultMessage;
    } catch (error) {
        sendLogToRenderer("IPC: Error processing after ambiguity resolution:");
        // Clear potentially inconsistent state on error
        pendingTransformationData = null; 
        currentOutputDirectory = null;
        processedFileInfo = {}; 
        skippedFileLog = [];
        errorFileLog = [];
        throw error; // Re-throw to the renderer
    }
});

// --- Helper Function to Generate Summary --- 
async function generateAndSendSummary(outputDirectory) {
    sendLogToRenderer("\n--- Generating Transformation Summary ---");
    const pagesDir = path.join(outputDirectory, 'pages');
    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let allStudents = new Set();
    let skippedDetails = [];
    let errorDetails = [];

    try {
        if (!fs.existsSync(pagesDir)) {
            sendLogToRenderer("WARN: Output 'pages' directory not found. Cannot generate summary.");
            return;
        }

        const studentDirs = fs.readdirSync(pagesDir).filter(item => {
            return fs.statSync(path.join(pagesDir, item)).isDirectory();
        });

        for (const studentIdentifier of studentDirs) {
            allStudents.add(studentIdentifier);
            const infoFilePath = path.join(pagesDir, studentIdentifier, 'processed_files.json');
            if (fs.existsSync(infoFilePath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(infoFilePath, 'utf-8'));
                    totalProcessed += data.processedFiles?.length || 0;
                    if (data.summary) {
                        totalSkipped += data.summary.skippedFiles?.length || 0;
                        totalErrors += data.summary.processingErrors?.length || 0;
                        
                        data.summary.skippedFiles?.forEach(skip => {
                            skippedDetails.push(`- ${studentIdentifier}/${skip.pageDir}/${skip.fileName} (Reason: ${skip.reason})`);
                        });
                        data.summary.processingErrors?.forEach(err => {
                            errorDetails.push(`- ${studentIdentifier}/${err.pageDir}/${err.fileName} (Error: ${err.error})`);
                        });
                    }
                } catch (readErr) {
                    sendLogToRenderer(`WARN: Could not read or parse ${infoFilePath}: ${readErr.message}`);
                }
            }
        }

        // Format Summary Message
        let summaryMessage = `\n--- Transformation Summary ---
`;
        summaryMessage += `Total Unique Students Processed: ${allStudents.size}\n`;
        summaryMessage += `Total Files Successfully Converted: ${totalProcessed}\n`;
        summaryMessage += `Total Files Skipped (Validation): ${totalSkipped}\n`;
        summaryMessage += `Total Files with Errors (Conversion): ${totalErrors}\n`;

        if (totalSkipped > 0) {
            summaryMessage += `\nSkipped Files:\n`;
            summaryMessage += skippedDetails.join('\n');
            summaryMessage += '\n';
        }

        if (totalErrors > 0) {
            summaryMessage += `\nFiles with Errors:\n`;
            summaryMessage += errorDetails.join('\n');
            summaryMessage += '\n';
        }
        summaryMessage += `----------------------------\n`;

        sendLogToRenderer(summaryMessage);

    } catch (summaryError) {
        sendLogToRenderer(`ERROR generating summary: ${summaryError.message}`);
    }
    // Clear logs after summary is generated
    skippedFileLog = [];
    errorFileLog = [];
}

/**
 * Generates a summary.html file in the output directory with tables showing
 * student submission statistics and overall statistics
 * @param {string} outputDirectory - The main output directory
 */
async function generateSummaryHtml(outputDirectory) {
    sendLogToRenderer("Generating summary.html report...");
    const pagesDir = path.join(outputDirectory, 'pages');
    if (!fs.existsSync(pagesDir)) {
        sendLogToRenderer("WARN: Pages directory not found. Cannot generate summary HTML.");
        return;
    }

    // Collect data from all students
    const studentData = [];
    const studentDirs = fs.readdirSync(pagesDir).filter(item => {
        return fs.statSync(path.join(pagesDir, item)).isDirectory();
    });

    for (const studentIdentifier of studentDirs) {
        const infoFilePath = path.join(pagesDir, studentIdentifier, 'processed_files.json');
        if (fs.existsSync(infoFilePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(infoFilePath, 'utf-8'));
                
                // Find student info (use the first processed file's studentInfo if available)
                let studentInfo = { 
                    primaryIdentifier: studentIdentifier,
                    fullName: studentIdentifier, 
                    lastName: studentIdentifier,
                    firstName: ""
                };
                
                if (data.processedFiles && data.processedFiles.length > 0 && 
                    data.processedFiles[0].studentInfo) {
                    studentInfo = data.processedFiles[0].studentInfo;
                }
                
                // Count processed, skipped, and error files
                const processedCount = data.processedFiles?.length || 0;
                const skippedCount = data.summary?.skippedFiles?.length || 0;
                const errorCount = data.summary?.processingErrors?.length || 0;

                studentData.push({
                    identifier: studentIdentifier,
                    info: studentInfo,
                    processed: processedCount,
                    skipped: skippedCount,
                    errors: errorCount
                });
            } catch (readErr) {
                sendLogToRenderer(`WARN: Could not read/parse ${infoFilePath}: ${readErr.message}`);
            }
        }
    }

    // Sort students by last name
    studentData.sort((a, b) => {
        const lastName1 = a.info.lastName || a.identifier;
        const lastName2 = b.info.lastName || b.identifier;
        return lastName1.localeCompare(lastName2);
    });

    // Calculate summary statistics
    const totalStudents = studentData.length;
    const totalSubmissions = studentData.reduce((sum, student) => sum + student.processed, 0);
    
    // Calculate distribution of page counts
    const pageDistribution = {};
    studentData.forEach(student => {
        const count = student.processed;
        pageDistribution[count] = (pageDistribution[count] || 0) + 1;
    });

    // Generate HTML content
    let htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Submission Summary</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        tr:nth-child(even) { background-color: #f9f9f9; }
        h1, h2 { color: #333; }
        .stats { margin-bottom: 30px; }
    </style>
</head>
<body>
    <h1>Student Submission Summary</h1>
    
    <table>
        <tr>
            <th>Last Name</th>
            <th>First Name</th>
            <th>Student ID</th>
            <th>Submitted Pages</th>
            <th>Skipped Files</th>
            <th>Files with Errors</th>
        </tr>`;

    // Add rows for each student
    studentData.forEach(student => {
        const lastName = student.info.lastName || "Unknown";
        const firstName = student.info.firstName || "";
        const studentId = student.info.studentNumber || "";
        
        htmlContent += `
        <tr>
            <td>${lastName}</td>
            <td>${firstName}</td>
            <td>${studentId}</td>
            <td>${student.processed}</td>
            <td>${student.skipped > 0 ? student.skipped : ''}</td>
            <td>${student.errors > 0 ? student.errors : ''}</td>
        </tr>`;
    });

    htmlContent += `
    </table>
    
    <h2>Summary Statistics</h2>
    
    <div class="stats">
        <p><strong>Total Students:</strong> ${totalStudents}</p>
        <p><strong>Total Submitted Pages:</strong> ${totalSubmissions}</p>
    </div>
    
    <h3>Distribution of Pages Per Student</h3>
    <table>
        <tr>
            <th>Number of Pages</th>
            <th>Number of Students</th>
        </tr>`;

    // Add rows for page distribution
    Object.keys(pageDistribution).sort((a, b) => Number(a) - Number(b)).forEach(pageCount => {
        htmlContent += `
        <tr>
            <td>${pageCount}</td>
            <td>${pageDistribution[pageCount]}</td>
        </tr>`;
    });

    htmlContent += `
    </table>
    
    <p><em>Report generated on ${new Date().toLocaleString()}</em></p>
</body>
</html>`;

    // Write the HTML file
    const summaryFilePath = path.join(outputDirectory, 'summary.html');
    try {
        fs.writeFileSync(summaryFilePath, htmlContent);
        sendLogToRenderer(`Summary HTML report created at: ${summaryFilePath}`);
    } catch (writeErr) {
        sendLogToRenderer(`ERROR: Failed to write summary HTML: ${writeErr.message}`);
    }
}
// --- End Summary Function ---

ipcMain.handle('start-merging', async (event, mainDirectory, outputDirectory) => {
    sendLogToRenderer(`IPC: Received start-merging for outputDir: ${outputDirectory}`);
    try {
        // Load config to get cover template content
        let config = {};
        let coverTemplateContent = `# Default Cover Template

Student: {{FULL_NAME}}
Number: {{STUDENTNUMBER}}

Submitted:
{{SUBMITTED_PAGES_LIST}}

Missing:
{{MISSING_PAGES_LIST}}`; // Default content
        try {
            if (fs.existsSync(CONFIG_PATH)) {
                config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
                if (config.coverTemplateContent) {
                    coverTemplateContent = config.coverTemplateContent;
                    sendLogToRenderer("IPC: Loaded cover template content from config.");
                } else {
                    sendLogToRenderer("IPC: No cover template content in config, using default.");
                }
            } else {
                 sendLogToRenderer("IPC: Config file not found, using default cover template.");
            }
        } catch (err) {
            sendLogToRenderer("IPC: Error reading config for cover template, using default:");
        }

        // Pass the template CONTENT string to mergeStudentPDFs
        await mergeStudentPDFs(mainDirectory, outputDirectory, coverTemplateContent);
        return "Success"; // Indicate success to renderer
    } catch (error) {
        sendLogToRenderer("IPC: Error during start-merging:");
        if (error.message.startsWith("Name collision detected")) {
            // Existing collision handling (consider if needed)
            // event.sender.send('name-collision', error.message);
        }
        // Re-throw error to be caught by renderer's try/catch block
        throw error;  
    }
});

// Re-enabled booklet creation using JS
ipcMain.handle('create-booklets', async (event, outputDirectory) => {
    sendLogToRenderer(`IPC: Received create-booklets request for outputDir: ${outputDirectory}`);
    try {
        const pdfsDir = path.join(outputDirectory, 'pdfs');
        const bookletsDir = path.join(outputDirectory, 'booklets');

        // Ensure the input pdfs directory exists
        if (!fs.existsSync(pdfsDir)) {
            sendLogToRenderer(`Error: Input PDF directory not found: ${pdfsDir}`);
            throw new Error(`Input PDF directory not found: ${pdfsDir}. Please run merging first.`);
        }

        // Ensure the output booklets directory exists
        if (!fs.existsSync(bookletsDir)) {
            sendLogToRenderer(`Creating booklets directory: ${bookletsDir}`);
            fs.mkdirSync(bookletsDir, { recursive: true }); // Use recursive true just in case
        }

        const studentPDFs = fs.readdirSync(pdfsDir).filter(f => f.endsWith('.pdf'));
        sendLogToRenderer(`Found ${studentPDFs.length} student PDFs in ${pdfsDir}`);

        if (studentPDFs.length === 0) {
            sendLogToRenderer("No PDFs found in the 'pdfs' directory to create booklets from.");
            return 'No PDFs found to create booklets from.';
        }

        // Process booklets sequentially to avoid overwhelming resources
        for (const pdfFile of studentPDFs) {
            const inputFilePath = path.join(pdfsDir, pdfFile);
            const outputFilePath = path.join(bookletsDir, pdfFile);
            sendLogToRenderer(`Attempting to create booklet for: ${inputFilePath} -> ${outputFilePath}`);
            try {
                await createSaddleStitchBooklet(inputFilePath, outputFilePath);
            } catch (bookletError) {
                // Log specific error and continue with the next file
                // Use filename directly, as full path isn't needed here
                const errorMsg = `Error creating booklet for ${pdfFile}: ${bookletError.message}`;
                sendLogToRenderer(errorMsg);
                if (mainWindow) mainWindow.webContents.send('error-log', errorMsg); // Log to UI
                // Create placeholder error file
                try {
                    const errorFilePath = outputFilePath.replace(/\.pdf$/, '_booklet_error.txt');
                    fs.writeFileSync(errorFilePath, `Failed to create booklet from: ${pdfFile}\nError: ${bookletError.message}\n${bookletError.stack || ''}`);
                    sendLogToRenderer(`Created error placeholder: ${errorFilePath}`);
                } catch (writeError) {
                    // Use filename directly
                    const writeErrorMsg = `Failed to write booklet error placeholder for ${pdfFile}: ${writeError.message}`;
                    sendLogToRenderer(writeErrorMsg);
                    if (mainWindow) mainWindow.webContents.send('error-log', `ERROR: ${writeErrorMsg}`);
                }
                // Optionally re-throw if one failure should stop the whole process
                // throw new Error(`Failed to create booklet for ${pdfFile}: ${bookletError.message}`); 
            }
        }

        sendLogToRenderer('Booklet creation process completed.');
        return 'Booklets created successfully!';
    } catch (error) {
        sendLogToRenderer('Error in create-booklets handler:');
        // Send the error back to the renderer process
        throw new Error(`Booklet creation failed: ${error.message}`); 
    }
});

// Modify saveProcessedFileInfo to properly handle email-based identifiers
async function saveProcessedFileInfo(outputDirectory) {
    sendLogToRenderer("Saving processed file information...");
    // The outputDirectory passed here is the *root* output dir
    const studentIdentifiers = new Set(Object.keys(processedFileInfo)); // Get unique identifiers processed

    // Find all student directories in the output/pages folder to ensure we cover students
    // even if they had no successfully processed files but had skips/errors.
    const pagesDir = path.join(outputDirectory, 'pages');
    if (fs.existsSync(pagesDir)) {
        fs.readdirSync(pagesDir).forEach(dir => {
            if (fs.statSync(path.join(pagesDir, dir)).isDirectory()) {
                studentIdentifiers.add(dir); // Add from directory structure too
            }
        });
    }

    for (const studentIdentifier of studentIdentifiers) {
        // Construct path to student directory inside 'pages'
        const studentOutputDir = path.join(outputDirectory, 'pages', studentIdentifier);
        const infoFilePath = path.join(studentOutputDir, 'processed_files.json');

        // Ensure the output directory exists
         if (!fs.existsSync(studentOutputDir)) {
             sendLogToRenderer(`WARN: Student output directory missing during save: ${studentOutputDir}. Creating.`);
             fs.mkdirSync(studentOutputDir, { recursive: true });
         }
        
        // Get successfully processed files for this student
        const successfulFiles = processedFileInfo[studentIdentifier] || [];

        // Get skipped and error files for this student from the global logs
        const skippedForStudent = skippedFileLog.filter(log => log.studentIdentifier === studentIdentifier)
                                                .map(log => ({ pageDir: log.pageDir, fileName: log.fileName, reason: log.reason }));
        const errorsForStudent = errorFileLog.filter(log => log.studentIdentifier === studentIdentifier)
                                             .map(log => ({ pageDir: log.pageDir, fileName: log.fileName, error: log.error }));

        // Prepare the final JSON structure
        const finalJsonData = {
            processedFiles: successfulFiles, // Existing structure
            summary: {
                skippedFiles: skippedForStudent,
                processingErrors: errorsForStudent
            }
        };
        
        try {
             fs.writeFileSync(infoFilePath, JSON.stringify(finalJsonData, null, 2));
             sendLogToRenderer(`  Saved info for ${studentIdentifier} to ${infoFilePath}`);
        } catch (err) {
            sendLogToRenderer(`  Error saving processed info for ${studentIdentifier}:`);
            sendLogToRenderer(err.message); // Log specific error
        }
    }
}

// --- Config Export/Import Handlers ---
ipcMain.handle('handle-export-config', async (event, currentConfig) => {
    const result = await dialog.showSaveDialog({
        title: 'Export Configuration',
        defaultPath: 'pdf-merger-config.json',
        filters: [
            { name: 'JSON Files', extensions: ['json'] }
        ]
    });

    if (result.canceled || !result.filePath) {
        return { success: false, cancelled: true };
    }

    const filePath = result.filePath;
    try {
        fs.writeFileSync(filePath, JSON.stringify(currentConfig, null, 2));
        sendLogToRenderer(`Config exported to ${filePath}`);
        return { success: true, filePath: filePath };
    } catch (error) {
        sendLogToRenderer(`Failed to export config to ${filePath}:`);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('handle-import-config', async (event) => {
    const result = await dialog.showOpenDialog({
        title: 'Import Configuration',
        properties: ['openFile'],
        filters: [
            { name: 'JSON Files', extensions: ['json'] }
        ]
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
    }

    const filePath = result.filePaths[0];
    try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const importedConfig = JSON.parse(fileContent);
        
        // Validate imported config? (Optional, basic check here)
        if (typeof importedConfig !== 'object' || importedConfig === null) {
            throw new Error('Invalid config file format.');
        }

        // Save the imported config to the standard location
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(importedConfig, null, 2));
        sendLogToRenderer(`Imported config from ${filePath} and saved to ${CONFIG_PATH}`);
        
        // Return the loaded config to the renderer
        return { success: true, config: importedConfig, filePath: filePath }; 
    } catch (error) {
        sendLogToRenderer(`Failed to import config from ${filePath}:`);
        return { success: false, error: error.message };
    }
});
// --- End Config Handlers ---

// *** CORRECTED Pre-checking Collisions Handler ***
ipcMain.handle('precheck-collisions', async (event, mainDirectory, folderPattern, useCSVs = false) => {
    sendLogToRenderer(`IPC: Received precheck-collisions (useCSVs: ${useCSVs})`);
    const collisionDetails = {}; // { pageDir: [collidingIdentifier1, ...], ... }
    let collisionFound = false;
    let mappingErrorFound = false; // Flag for missing someNumber mappings
    const mappingErrors = []; // Store details of missing mappings
    
    // If requested, parse CSV files to help resolve collisions
    let emailMap = {};
    let pagesWithCSV = new Set();
    let pagesWithoutCSV = new Set();
    let allPages = new Set();
    
    if (useCSVs) {
        sendLogToRenderer("Precheck: Parsing CSV files for email mappings");
        const csvResult = await parseCSVsInDirectory(mainDirectory);
        emailMap = csvResult.emailMappings;
        pagesWithCSV = csvResult.pagesWithCSV;
        pagesWithoutCSV = csvResult.pagesWithoutCSV;
        allPages = csvResult.allPages;
        sendLogToRenderer(`Precheck: Loaded ${Object.keys(emailMap).length} email mappings from CSVs`);
    }

    try {
        if (!fs.existsSync(mainDirectory)) {
            throw new Error(`Input directory does not exist: ${mainDirectory}`);
        }

        const pageDirs = fs.readdirSync(mainDirectory).filter(item => {
            const itemPath = path.join(mainDirectory, item);
            return fs.statSync(itemPath).isDirectory();
        });

        if (pageDirs.length === 0) {
            sendLogToRenderer("Pre-check: No page directories found.");
            return { collisionDetected: false }; 
        }

        // Track name appearances across pages
        const studentNamesAcrossPages = new Map(); // Map<identifierName, Set<pageDir>>
        const actualCollidingNames = new Set(); // Names with actual intra-page collisions
        
        // Check each page directory independently
        for (const pageDir of pageDirs) {
            const pageDirPath = path.join(mainDirectory, pageDir);
            const studentFolders = fs.readdirSync(pageDirPath).filter(item => {
                const itemPath = path.join(pageDirPath, item);
                return fs.statSync(itemPath).isDirectory();
            });

            // Map identifiers found *within this specific page directory*
            const pageIdentifierMap = new Map(); // Map<IdentifierName, Array<{folderName, email}>>
            let pageHasCsv = useCSVs && pagesWithCSV.has(pageDir);

            for (const studentFolder of studentFolders) {
                const parsedInfo = parseFolderName(studentFolder, folderPattern);
                let identifier = parsedInfo.primaryIdentifier; // Usually the name
                let currentEmail = null; // Track email resolved for this folder
                
                // If using CSVs and this is a Moodle format folder name with someNumber
                if (useCSVs && folderPattern?.startsWith('FULLNAMEWITHSPACES') && parsedInfo.someNumber) {
                    const email = emailMap[parsedInfo.someNumber];
                    if (email) {
                        // Use email as identifier to help resolve collisions
                        identifier = email;
                        currentEmail = email;
                        sendLogToRenderer(`Precheck: Resolved ${studentFolder} to ${email} using CSV mapping`);
                    } else if (pageHasCsv) {
                        // *** New Check: CSV exists for this page, but no mapping for this someNumber ***
                        sendLogToRenderer(`Precheck Mapping Error: Page '${pageDir}' has a CSV, but no email mapping found for someNumber '${parsedInfo.someNumber}' in folder '${studentFolder}'.`);
                        mappingErrors.push({ 
                            pageDir: pageDir, 
                            studentFolder: studentFolder, 
                            someNumber: parsedInfo.someNumber 
                        });
                        mappingErrorFound = true;
                        // Don't use email as identifier if mapping missing
                    }
                }

                // Track this student name's appearance across pages for CSV coverage checking
                if (!studentNamesAcrossPages.has(identifier)) {
                    studentNamesAcrossPages.set(identifier, new Set());
                }
                studentNamesAcrossPages.get(identifier).add(pageDir);
                
                if (!pageIdentifierMap.has(identifier)) {
                    pageIdentifierMap.set(identifier, []);
                }
                pageIdentifierMap.get(identifier).push({
                    folderName: studentFolder,
                    email: currentEmail, // Use the potentially resolved email
                    someNumber: parsedInfo.someNumber
                });
            }
            
            // Check for collisions within this page directory
            const pageCollisions = [];
            for (const [identifier, folders] of pageIdentifierMap.entries()) {
                if (folders.length > 1) {
                    // If using emails and we have different emails, it's not really a collision
                    if (useCSVs) {
                        const uniqueEmails = new Set(folders.map(f => f.email).filter(Boolean));
                        if (uniqueEmails.size > 1) {
                            sendLogToRenderer(`Precheck: Found distinct emails for ${identifier}, not a collision`);
                            continue; // Skip this as it's not a real collision
                        }
                    }
                    
                    // Multiple different original folders map to the same identifier in this page directory
                    pageCollisions.push(identifier);
                    actualCollidingNames.add(identifier); // Track actual colliding names
                    collisionFound = true;
                    sendLogToRenderer(`Pre-check Collision Detected in PAGE '${pageDir}': Identifier '${identifier}' maps to multiple original folders: ${folders.map(f => f.folderName).join(', ')}`);
                }
            }
            
            if (pageCollisions.length > 0) {
                collisionDetails[pageDir] = pageCollisions;
            }
        }

        // Check for partial CSV coverage when using CSVs
        let partialCsvCoverage = false;
        let missingCsvPages = [];
        let studentsAffectedByPartialCSV = []; // Students that appear in multiple pages
        
        if (useCSVs && pagesWithCSV.size > 0 && pagesWithoutCSV.size > 0) {
            sendLogToRenderer("Checking for partial CSV coverage issues...");
            
            // If there are both pages with and without CSV files, that's a partial coverage issue
            partialCsvCoverage = true;
            missingCsvPages = Array.from(pagesWithoutCSV);
            
            // Find all students that appear in multiple pages (they need consistent handling)
            for (const [identifier, pageSet] of studentNamesAcrossPages.entries()) {
                if (pageSet.size > 1) {
                    studentsAffectedByPartialCSV.push(identifier);
                }
            }
            
            // If any students appear in multiple pages, we need CSVs everywhere
            if (studentsAffectedByPartialCSV.length > 0) {
                sendLogToRenderer(`Partial CSV coverage detected! Missing CSV in: ${missingCsvPages.join(', ')}`);
                sendLogToRenderer(`Students appearing in multiple pages: ${studentsAffectedByPartialCSV.join(', ')}`);
                
                // Mark this as a collision - but don't mix up students affected with actual colliding names
                if (studentsAffectedByPartialCSV.length > 0) {
                    collisionFound = true;
                }
            } else {
                // If no students appear in multiple pages, then partial CSV is not an issue
                partialCsvCoverage = false;
            }
        }

        // Return overall result
        // Combine collisionFound and mappingErrorFound
        if (collisionFound || mappingErrorFound) { 
            // Extract just the unique names across all page collisions
            // Use the actual colliding names for the collision list - not the students affected by partial CSV
            const uniqueCollidingNames = [...actualCollidingNames];
            
            sendLogToRenderer(`IPC: Pre-check finished. Collisions: ${collisionFound}, Mapping Errors: ${mappingErrorFound}. Colliding names: ${uniqueCollidingNames.join(', ')}. Mapping errors count: ${mappingErrors.length}`);
            return { 
                collisionDetected: collisionFound, // Keep original collision flag
                mappingErrorDetected: mappingErrorFound, // Add new flag
                collidingNames: uniqueCollidingNames,
                mappingErrors: mappingErrors, // Return details of mapping errors
                usedCSVs: useCSVs, 
                csvMappingsCount: useCSVs ? Object.keys(emailMap).length : 0,
                partialCsvCoverage,
                missingCsvPages,
                studentsAffected: studentsAffectedByPartialCSV
            }; 
        } else {
            sendLogToRenderer("IPC: Pre-check found no name collisions or mapping errors within any page directory.");
            return { 
                collisionDetected: false,
                mappingErrorDetected: false, // No mapping errors
                collidingNames: [],
                mappingErrors: [], // Empty list
                usedCSVs: useCSVs,
                csvMappingsCount: useCSVs ? Object.keys(emailMap).length : 0,
                partialCsvCoverage,
                missingCsvPages,
                studentsAffected: studentsAffectedByPartialCSV
            };
        }

    } catch (error) {
        sendLogToRenderer("IPC: Error during precheck-collisions:");
        throw error;
    }
});

// --- Clear Output Handler ---
ipcMain.handle('clear-output-folder', async (event, outputDirectory) => {
    sendLogToRenderer(`IPC: Received clear-output-folder for: ${outputDirectory}`);
    if (!outputDirectory || !fs.existsSync(outputDirectory)) {
        const msg = "Output directory path is invalid or does not exist.";
        sendLogToRenderer(`Clear Output Error: ${msg}`);
        return { success: false, message: msg };
    }

    const foldersToClear = ['pages', 'pdfs', 'booklets'];
    let errors = [];

    for (const folder of foldersToClear) {
        const folderPath = path.join(outputDirectory, folder);
        if (fs.existsSync(folderPath)) {
            sendLogToRenderer(`Attempting to clear: ${folderPath}`);
            try {
                fs.rmSync(folderPath, { recursive: true, force: true });
                sendLogToRenderer(`Successfully cleared: ${folderPath}`);
            } catch (err) {
                // Use relative path for folder
                const relativeFolderPath = path.relative(outputDirectory, folderPath);
                const errorMsg = `Failed to clear subfolder '${relativeFolderPath}': ${err.message}`;
                sendLogToRenderer(errorMsg);
                errors.push(errorMsg);
                if (mainWindow) mainWindow.webContents.send('error-log', `ERROR: ${errorMsg}`);
            }
        } else {
            // Use relative path
            sendLogToRenderer(`Subfolder does not exist, skipping clear: ${path.relative(outputDirectory, folderPath)}`);
        }
    }

    // Also clear summary.html if it exists
    const summaryHtmlPath = path.join(outputDirectory, 'summary.html');
    if (fs.existsSync(summaryHtmlPath)) {
        try {
            fs.unlinkSync(summaryHtmlPath);
            sendLogToRenderer(`Deleted summary.html at: ${summaryHtmlPath}`);
        } catch (err) {
            const errorMsg = `Failed to delete summary.html: ${err.message}`;
            sendLogToRenderer(errorMsg);
            errors.push(errorMsg);
            if (mainWindow) mainWindow.webContents.send('error-log', `ERROR: ${errorMsg}`);
        }
    }

    if (errors.length > 0) {
        return { success: false, message: `Errors occurred during cleanup: ${errors.join('; ')}` };
    } else {
        return { success: true, message: 'Output folders (pages, pdfs, booklets) cleared successfully.' };
    }
});
// --- End Clear Output Handler ---

// --- IPC Handlers for MBZ Batch Creator Dependencies --- 
ipcMain.handle('dialog:showOpenDialog', async (event, options) => {
    return dialog.showOpenDialog(mainWindow, options);
});

ipcMain.handle('dialog:showSaveDialog', async (event, options) => {
    return dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('dialog:showMessageBox', async (event, options) => {
    return dialog.showMessageBox(mainWindow, options);
});

ipcMain.handle('path-basename', async (event, filePath) => { // Corrected channel name
    return path.basename(filePath);
});

ipcMain.handle('path-dirname', (event, filePath) => { // Added missing handler
    return path.dirname(filePath);
});

// Add handler for getUserDataPath
ipcMain.handle('app:getUserDataPath', (event) => {
    return app.getPath('userData');
});
// --- End IPC Handlers for Dependencies --- 

// --- IPC Handler to load HTML template ---
ipcMain.handle('load-mbz-creator-html', async (event) => {
  try {
    // Corrected path: Go up one level from src/js to src, then find the file
    const htmlPath = path.join(__dirname, '..', 'mbz_creator.html'); 
    sendLogToRenderer(`Attempting to load HTML from: ${htmlPath}`);
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    return htmlContent;
  } catch (error) {
    sendLogToRenderer('Error loading mbz_creator.html:');
    throw new Error(`Could not load MBZ Creator template: ${error.message}`); // Rethrow to renderer
  }
});
// --- End HTML Loader ---

// --- IPC Handler for MBZ Batch Creation --- 
ipcMain.handle('mbz:createBatchAssignments', async (event, incomingOptions) => {
  sendLogToRenderer('IPC: Received mbz:createBatchAssignments with incoming options:');

  // **Adapt incomingOptions to the format required by modifyMoodleBackup**
  // Assumptions based on old createBatchAssignments signature and typical UI inputs:
  // - incomingOptions.mbzFilePath: Path to template MBZ (INPUT)
  // - incomingOptions.selectedDates: Array of Date objects or ISO strings? Assume ISO strings for robustness.
  // - incomingOptions.timeHour, incomingOptions.timeMinute: Deadline time components.
  // - incomingOptions.namePrefix: Assignment name prefix.
  // - incomingOptions.outputDir: Optional output directory.
  // - incomingOptions.outputFilename: Optional output filename.
  // - Potentially missing: sectionTitle, targetStartDate - need defaults or UI additions?

  try {
    // 1. Prepare options for generateAssignmentDates
    const submissionTime = `${String(incomingOptions.timeHour || 0).padStart(2, '0')}:${String(incomingOptions.timeMinute || 0).padStart(2, '0')}:00`;
    const dateGenOpts = {
        // Assuming selectedDates are ISO strings or YYYY-MM-DD strings
        // If they are Date objects, need to format them first
        submissionDates: incomingOptions.selectedDates?.map(d => typeof d === 'string' ? d.split('T')[0] : new Date(d).toISOString().split('T')[0]).join(','),
        submissionTime: submissionTime,
        // extraTime: 60, // Use default from modifyMoodleBackup or get from UI?
        assignmentNamePrefix: incomingOptions.namePrefix || 'Assignment',
    };
    const assignments = generateAssignmentDates(dateGenOpts);
    if (!assignments || assignments.length === 0) {
        throw new Error("Failed to generate assignment date data from selected dates.");
    }

    // 2. Prepare options for modifyMoodleBackup
    const outputDir = incomingOptions.outputDir || path.dirname(incomingOptions.mbzFilePath);
    
    // Use the provided filename from the save dialog if available, otherwise generate one
    let outputFilename;
    if (incomingOptions.outputFilename) {
      outputFilename = incomingOptions.outputFilename;
    } else {
      outputFilename = `${path.basename(incomingOptions.mbzFilePath, '.mbz')}-modified-${Date.now()}.mbz`;
    }
    
    const finalOutputPath = path.join(outputDir, outputFilename);

    const modifyOptions = {
        inputMbzPath: incomingOptions.mbzFilePath,
        outputMbzPath: finalOutputPath,
        assignments: assignments,
        sectionTitle: incomingOptions.sectionTitle, // TODO: Ensure this is passed from UI
        targetStartTimestamp: null, // TODO: Add UI input for target start date?
    };

    // Optional: Set targetStartTimestamp if provided from UI (example)
    if (incomingOptions.targetStartDate) { // Assuming targetStartDate is YYYY-MM-DD string
         modifyOptions.targetStartTimestamp = Math.floor(new Date(`${incomingOptions.targetStartDate}T00:00:00Z`).getTime() / 1000);
    }

    sendLogToRenderer("Calling modifyMoodleBackup with options:");

    // 3. Call the new function
    await modifyMoodleBackup(modifyOptions);

    // 4. Return success result
    sendLogToRenderer(`modifyMoodleBackup completed successfully. Output: ${finalOutputPath}`);
    return { success: true, outputPath: finalOutputPath, message: "MBZ file created successfully." };

  } catch (error) {
    sendLogToRenderer('Error during mbz:createBatchAssignments handling:');
    return { success: false, message: error.message || 'An unknown error occurred.' };
  }
});
// --- End IPC Handler for MBZ Batch Creation --- 

// --- IPC Handlers ---

// Function to safely get the path to the default MBZ template
function getDefaultMbzTemplatePath() {
  let templateMbzPath;
  const templateFilename = 'moodle-4.5-2024100700.mbz'; // Define filename centrally
  
  if (app.isPackaged) {
    // Packaged app: Path relative to resources dir, inside app.asar.unpacked
    templateMbzPath = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'src',
      'assets',
      'mbz-templates',
      templateFilename
    );
  } else {
    // Development: Path relative to the project root (__dirname is src/js)
    templateMbzPath = path.join(
      __dirname,       // src/js
      '..',            // src/
      'assets',
      'mbz-templates',
      templateFilename
    );
  }
  return templateMbzPath;
}

// Expose the template path getter via IPC
ipcMain.handle('get-default-mbz-template-path', async () => {
  return getDefaultMbzTemplatePath();
});

// Existing IPC handler for fs.exists
ipcMain.handle('fs-exists', async (event, filePath) => {
  return fs.promises.access(filePath, fs.constants.F_OK);
});