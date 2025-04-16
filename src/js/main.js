const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync'); // Import sync parser

// Updated require to include new functions and error
const {
    mergeStudentPDFs,
    processSingleTransformation,  
    createSaddleStitchBooklet
} = require('./pdf-merger');

// Keep track of the main window
let mainWindow = null;

// Global store for processed file info during transformation
let processedFileInfo = {}; // Format: { studentName: [{ pageName: string, originalFileName: string }, ...] }

// Store transformation context globally
let pendingTransformationData = null; 
let currentTransformationDpi = 300; 
let currentOutputDirectory = null;
let someNumberToEmailMap = {}; // Global map for CSV lookup

function createWindow() {
    const win = new BrowserWindow({
        width: 850,
        height: 750,
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
    if (fs.existsSync(CONFIG_PATH)) {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH));
        win.webContents.on('did-finish-load', () => {
            // Use mainWindow here safely as it's set by now
             if(mainWindow) mainWindow.webContents.send('load-config', config);
        });
    }

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
        // You can add more menus like Window, Help etc.
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



const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

ipcMain.on('save-config', (event, config) => {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); // Added pretty-printing
        console.log(`Config saved to ${CONFIG_PATH}`);
    } catch (error) {
        console.error(`Failed to save config to ${CONFIG_PATH}:`, error);
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
    console.log("Preparing transformations...");
    
    // Use the shared CSV parsing function
    const csvResult = await parseCSVsInDirectory(mainDirectory); // Assign the whole result object
    someNumberToEmailMap = csvResult.emailMappings; // Extract the email mappings
    console.log(`Loaded ${Object.keys(someNumberToEmailMap).length} email mappings from CSVs (Pages with CSV: ${csvResult.pagesWithCSV.size}, without: ${csvResult.pagesWithoutCSV.size})`); // Log more info
    
    const transformationTasks = [];
    const ambiguities = [];

    if (!fs.existsSync(mainDirectory)) {
        throw new Error(`Input directory does not exist: ${mainDirectory}`);
    }
    
    if (!fs.existsSync(outputDirectory)) {
        console.log(`Creating output directory: ${outputDirectory}`);
        fs.mkdirSync(outputDirectory, { recursive: true });
    }
    
    const pageDirs = fs.readdirSync(mainDirectory).filter(item => {
        const itemPath = path.join(mainDirectory, item);
        return fs.statSync(itemPath).isDirectory();
    });
    
    console.log(`Found ${pageDirs.length} page directories: ${pageDirs.join(', ')}`);
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
            const validFiles = fs.readdirSync(studentFolderPath).filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.pdf', '.png', '.jpg', '.jpeg', '.heic'].includes(ext);
            });
            
            if (validFiles.length === 0) continue;
            
            const parsedInfo = parseFolderName(studentFolder, folderPattern);
            const studentIdentifier = parsedInfo.primaryIdentifier;
            const studentOutputDir = path.join(outputDirectory, 'pages', studentIdentifier); // Path corrected earlier
            if (!fs.existsSync(studentOutputDir)) {
                fs.mkdirSync(studentOutputDir, { recursive: true });
            }
            const outputFilePath = path.join(studentOutputDir, `${pageDir}.pdf`);
            
            if (validFiles.length === 1) {
                transformationTasks.push({
                    inputPath: path.join(studentFolderPath, validFiles[0]),
                    outputPath: outputFilePath,
                    pageName: pageDir,
                    originalFileName: validFiles[0],
                    studentInfo: parsedInfo // Contains identifier, name, and potentially someNumber
                });
            } else {
                ambiguities.push({
                    folderPath: studentFolderPath,
                    files: validFiles,
                    context: `Student: ${studentFolder}, Page: ${pageDir}`
                });
            }
        }
    }
    
    console.log(`Preparation complete. Tasks: ${transformationTasks.length}, Ambiguities: ${ambiguities.length}. Email map size: ${Object.keys(someNumberToEmailMap).length}`);
    return { tasks: transformationTasks, ambiguities };
}


ipcMain.handle('start-transformation', async (event, mainDirectory, outputDirectory, dpi) => {
    console.log("IPC: Received start-transformation");
    pendingTransformationData = null; 
    currentTransformationDpi = dpi;   
    currentOutputDirectory = outputDirectory;
    processedFileInfo = {}; 

    let config = {};
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (err) {
        console.warn("Could not load config for transformation, using defaults.");
    }
    const folderPattern = config.foldernamePattern;
    const isMoodleMode = folderPattern?.startsWith('FULLNAMEWITHSPACES');
    console.log(`Using folder pattern: ${folderPattern}, Moodle Mode: ${isMoodleMode}`);

    try {
        let { tasks, ambiguities } = await prepareTransformations(mainDirectory, outputDirectory, folderPattern);
        console.log(`IPC: Initial preparation complete. Tasks: ${tasks.length}, Ambiguities: ${ambiguities.length}. Email map size: ${Object.keys(someNumberToEmailMap).length}`);

        // --- Collision Resolution Attempt (Moodle Mode) ---
        if (isMoodleMode && tasks.length > 0) {
            console.log("Attempting Moodle collision resolution using emails...");
            const identifierGroups = tasks.reduce((acc, task) => {
                const id = task.studentInfo.primaryIdentifier;
                if (!acc[id]) acc[id] = [];
                acc[id].push(task);
                return acc;
            }, {});

            let resolvedCollisions = 0;
            for (const identifier in identifierGroups) {
                if (identifierGroups[identifier].length > 1) { // Potential collision
                    console.log(`Potential collision for identifier: ${identifier}`);
                    let canResolveAll = true;
                    let allEmails = new Set();

                    for (const task of identifierGroups[identifier]) {
                        const someNum = task.studentInfo.someNumber;
                        const email = someNum ? someNumberToEmailMap[someNum] : null;
                        if (email) {
                            allEmails.add(email);
                            task.studentInfo.email = email; // Store email for potential use
                        } else {
                            console.warn(`Cannot resolve for ${identifier}: Task for ${task.originalFileName} missing someNumber or email mapping.`);
                            canResolveAll = false;
                            break; // Cannot resolve this group
                        }
                    }

                    // If all tasks in the group had a mapped email AND there are multiple unique emails
                    if (canResolveAll && allEmails.size > 1) {
                         console.log(`Resolving collision for ${identifier} using emails.`);
                         identifierGroups[identifier].forEach(task => {
                             task.studentInfo.primaryIdentifier = task.studentInfo.email;
                             // Also update the outputPath to reflect the new identifier
                             task.outputPath = path.join(outputDirectory, 'pages', task.studentInfo.primaryIdentifier, `${task.pageName}.pdf`);
                             console.log(`  Updated task for ${task.originalFileName} -> ID: ${task.studentInfo.primaryIdentifier}, Path: ${task.outputPath}`);
                         });
                         resolvedCollisions++;
                    } else if (canResolveAll && allEmails.size <= 1) {
                        // All map to the same email or only one email found (no actual collision)
                        console.log(`Collision group for ${identifier} resolved to single email or no conflict. No change needed.`);
                    } else {
                        console.warn(`Could not fully resolve collision for ${identifier} using emails.`);
                    }
                }
            }
             if (resolvedCollisions > 0) {
                 console.log(`Automatically resolved ${resolvedCollisions} name collisions using emails.`);
             }
        }
        // --- End Collision Resolution Attempt ---
        
        // --- CORRECTED Final Collision Check V7 ---
        console.log("Performing final collision check V7...");
        const finalIdentifierGroups = tasks.reduce((acc, task) => {
            const finalId = task.studentInfo.primaryIdentifier;
            if (!acc[finalId]) {
                acc[finalId] = {
                    originKeys: new Set(),
                    taskExamples: [], // Store examples for error message
                    pageFolders: new Set() // Track which page folders we've seen this ID in
                };
            }
            
            // Determine the key representing the original student submission
            // For origin key, we need something that represents the STUDENT, not the submission instance
            let originKey;
            const folderName = path.basename(path.dirname(task.inputPath));
            
            // Add the page folder this task is from
            const pageFolder = path.basename(path.dirname(path.dirname(task.inputPath)));
            acc[finalId].pageFolders.add(pageFolder);
            
            if (isMoodleMode) {
                // In Moodle mode, extract the name part without the someNumber
                // This should be consistent across all submissions from the same student
                const moodleSuffix = '_assignsubmission_file_';
                if (folderName.includes(moodleSuffix)) {
                    // For Moodle folders, use the fullName part as the origin key
                    originKey = task.studentInfo.fullName;
                } else {
                    // Fallback for non-standard folders
                    originKey = folderName;
                }
            } else {
                // In non-Moodle mode, use original folder name
                originKey = folderName;
            }
            
            acc[finalId].originKeys.add(originKey);
            
            // Keep track of a few task input paths for context in error messages
            if (acc[finalId].taskExamples.length < 3) {
                 acc[finalId].taskExamples.push(`${path.basename(task.inputPath)} (from ${pageFolder})`);
            }
            return acc;
        }, {});

        const finalCollisionsData = [];
        for (const identifier in finalIdentifierGroups) {
            const group = finalIdentifierGroups[identifier];
            // We only have a collision if multiple DISTINCT originKeys map to the same identifier
            if (group.originKeys.size > 1) {
                 console.error(`Final Collision Error V7: Identifier '${identifier}' associated with multiple distinct origins: ${Array.from(group.originKeys).join(', ')}. Example files involved: ${group.taskExamples.join(', ')}`);
                 finalCollisionsData.push(`${identifier} (from origins: ${Array.from(group.originKeys).join(', ')})`);
            } else if (group.pageFolders.size > 1) {
                 // This is the expected case: same student has files in multiple page folders
                 console.log(`Student '${identifier}' has submissions in multiple page folders: ${Array.from(group.pageFolders).join(', ')}`);
            }
        }

        if (finalCollisionsData.length > 0) {
            const collisionDetails = finalCollisionsData.join('; ');
            console.error(`Final check V7 failed: Unresolvable collisions detected: ${collisionDetails}`);
            throw new Error(`FinalCollisionError: Unresolvable collisions found: ${collisionDetails}. Please rename input folders manually or provide/correct CSVs.`);
        }
        console.log("Final collision check V7 passed.");
        // --- End Final Collision Check ---

        // Store data for potential later ambiguity resolution
        pendingTransformationData = { unambiguousTasks: tasks, ambiguities, outputDirectory }; 

        if (ambiguities.length > 0) {
            // Send request to renderer to resolve ambiguity
            console.log("IPC: Ambiguities found. Requesting resolution from renderer.");
            if (mainWindow) {
                mainWindow.webContents.send('request-ambiguity-resolution', ambiguities);
            }
            // Indicate to renderer that resolution is needed by returning a specific status
            // throw new Error("Ambiguity detected. Please resolve file conflicts."); 
            return { status: 'ambiguity_detected', message: 'Ambiguity detected. Please resolve conflicts.' };
        } else {
            // No ambiguities, process tasks directly
            console.log("IPC: No ambiguities or collisions. Processing tasks directly.");
            let successCount = 0;
            let errorCount = 0;
            const totalTasks = tasks.length;

            for (let i = 0; i < totalTasks; i++) {
                const task = tasks[i];
                // Ensure output directory exists *before* processing (important after potential path update)
                const taskOutputDir = path.dirname(task.outputPath);
                if (!fs.existsSync(taskOutputDir)) {
                    console.log(`Creating task output directory: ${taskOutputDir}`);
                    fs.mkdirSync(taskOutputDir, { recursive: true });
                }

                // Send progress update before processing
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
                    await processSingleTransformation(task.inputPath, task.outputPath, currentTransformationDpi);
                    successCount++;
                    // --- Store processed file info ---
                    const studentIdentifier = task.studentInfo?.primaryIdentifier || path.basename(path.dirname(task.outputPath));
                    if (!processedFileInfo[studentIdentifier]) processedFileInfo[studentIdentifier] = [];
                    processedFileInfo[studentIdentifier].push({ 
                        pageName: task.pageName, 
                        originalFileName: task.originalFileName,
                        studentInfo: task.studentInfo
                    });
                    // --- End Store --- 
                } catch (processingError) {
                    console.error(`Error during initial transformation for ${task.inputPath}:`, processingError);
                    errorCount++;
                }
            }
            // --- Save processed info after loop --- 
            await saveProcessedFileInfo(currentOutputDirectory);
            pendingTransformationData = null; 
            currentOutputDirectory = null;
            console.log(`IPC: Transformation processing complete. Success: ${successCount}, Errors: ${errorCount}`);
            if (errorCount > 0) {
                throw new Error(`Transformation completed with ${errorCount} error(s).`);
            } else {
                return `Transformation completed successfully for ${successCount} file(s).`;
            }
        }

    } catch (error) {
        console.error("IPC: Error during transformation start:", error);
        throw error; // Re-throw to renderer (will catch FinalCollisionError too)
    }
});

ipcMain.handle('resolve-ambiguity', async (event, selectedIdentifiers) => {
    console.log("Resolving ambiguity with selected identifiers:", selectedIdentifiers);
    
    // Create a mapping from email to new identifier
    const emailToIdentifier = {};
    
    // Process all the selected identifiers (from the UI resolution)
    for (const key in selectedIdentifiers) {
        const identifier = selectedIdentifiers[key];
        // Store original mapping to fix the issue
        emailToIdentifier[key] = identifier;
        
        // This ensures we properly associate the tasks with the correct email-based identifier
        for (const ambiguity of pendingAmbiguities) {
            // Find matching ambiguity based on display key (which contains the folder name)
            if (ambiguity.displayKey === key) {
                // Associate all tasks in this ambiguity with the selected identifier
                for (const task of ambiguity.tasks) {
                    // Important - use the email as the identifier if it exists
                    if (task.studentInfo && task.studentInfo.email) {
                        task.primaryIdentifier = task.studentInfo.email;
                    } else {
                        task.primaryIdentifier = identifier;
                    }
                }
            }
        }
    }
    
    console.log("Email to identifier mapping:", emailToIdentifier);
    
    // Now we need to remap the tasks in pendingTransformations
    for (const task of pendingTransformations) {
        const originalIdentifier = task.primaryIdentifier;
        // If the task had an email, use that as the identifier for consistency
        if (task.studentInfo && task.studentInfo.email) {
            task.primaryIdentifier = task.studentInfo.email;
            console.log(`Remapping task for ${originalIdentifier} to email ${task.primaryIdentifier}`);
        }
        // If the task's display key was resolved in the UI
        else if (task.displayKey && emailToIdentifier[task.displayKey]) {
            task.primaryIdentifier = emailToIdentifier[task.displayKey];
            console.log(`Remapping task for ${originalIdentifier} to resolved identifier ${task.primaryIdentifier}`);
        }
    }
    
    // Rest of the existing code for transformations
    // ... existing code ...
});

ipcMain.handle('start-merging', async (event, mainDirectory, outputDirectory) => {
    console.log(`IPC: Received start-merging for outputDir: ${outputDirectory}`);
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
                    console.log("IPC: Loaded cover template content from config.");
                } else {
                    console.log("IPC: No cover template content in config, using default.");
                }
            } else {
                 console.log("IPC: Config file not found, using default cover template.");
            }
        } catch (err) {
            console.error("IPC: Error reading config for cover template, using default:", err);
        }

        // Pass the template CONTENT string to mergeStudentPDFs
        await mergeStudentPDFs(mainDirectory, outputDirectory, coverTemplateContent);
        return "Success"; // Indicate success to renderer
    } catch (error) {
        console.error("IPC: Error during start-merging:", error);
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
    console.log(`IPC: Received create-booklets request for outputDir: ${outputDirectory}`);
    try {
        const pdfsDir = path.join(outputDirectory, 'pdfs');
        const bookletsDir = path.join(outputDirectory, 'booklets');

        // Ensure the input pdfs directory exists
        if (!fs.existsSync(pdfsDir)) {
            console.error(`Error: Input PDF directory not found: ${pdfsDir}`);
            throw new Error(`Input PDF directory not found: ${pdfsDir}. Please run merging first.`);
        }

        // Ensure the output booklets directory exists
        if (!fs.existsSync(bookletsDir)) {
            console.log(`Creating booklets directory: ${bookletsDir}`);
            fs.mkdirSync(bookletsDir, { recursive: true }); // Use recursive true just in case
        }

        const studentPDFs = fs.readdirSync(pdfsDir).filter(f => f.endsWith('.pdf'));
        console.log(`Found ${studentPDFs.length} student PDFs in ${pdfsDir}`);

        if (studentPDFs.length === 0) {
            console.warn("No PDFs found in the 'pdfs' directory to create booklets from.");
            return 'No PDFs found to create booklets from.';
        }

        // Process booklets sequentially to avoid overwhelming resources
        for (const pdfFile of studentPDFs) {
            const inputFilePath = path.join(pdfsDir, pdfFile);
            const outputFilePath = path.join(bookletsDir, pdfFile);
            console.log(`Attempting to create booklet for: ${inputFilePath} -> ${outputFilePath}`);
            try {
                await createSaddleStitchBooklet(inputFilePath, outputFilePath);
            } catch (bookletError) {
                // Log specific error and continue with the next file
                console.error(`Error creating booklet for ${pdfFile}:`, bookletError);
                // Optionally re-throw if one failure should stop the whole process
                // throw new Error(`Failed to create booklet for ${pdfFile}: ${bookletError.message}`); 
            }
        }

        console.log('Booklet creation process completed.');
        return 'Booklets created successfully!';
    } catch (error) {
        console.error('Error in create-booklets handler:', error);
        // Send the error back to the renderer process
        throw new Error(`Booklet creation failed: ${error.message}`); 
    }
});

// Modify saveProcessedFileInfo to properly handle email-based identifiers
async function saveProcessedFileInfo(outputDirectory) {
    console.log("Saving processed file information...");
    // The outputDirectory passed here is the *root* output dir
    for (const studentIdentifier in processedFileInfo) {
        // Construct path to student directory inside 'pages'
        const studentOutputDir = path.join(outputDirectory, 'pages', studentIdentifier);
        const infoFilePath = path.join(studentOutputDir, 'processed_files.json');
        
        // Get the data for this student
        const allEntries = processedFileInfo[studentIdentifier];
        
        // Filter out entries that have different email addresses to handle collision resolution
        // Group by email if available, to separate different students with same name
        const emailGroups = new Map();
        
        allEntries.forEach(entry => {
            const email = entry.studentInfo?.email;
            // If this entry has an email (from CSV resolution)
            if (email) {
                // If email doesn't match the identifier, it might be from a different student with same name
                if (email !== studentIdentifier && studentIdentifier.includes('@') === false) {
                    console.warn(`Entry for ${studentIdentifier} has email ${email} that doesn't match identifier. Possible mixed data.`);
                }
                
                // Group by email
                if (!emailGroups.has(email)) {
                    emailGroups.set(email, []);
                }
                emailGroups.get(email).push(entry);
            } else {
                // No email, use a special key for entries without email
                if (!emailGroups.has('no_email')) {
                    emailGroups.set('no_email', []);
                }
                emailGroups.get('no_email').push(entry);
            }
        });
        
        // If we have multiple email groups, there's a collision that was resolved with emails
        if (emailGroups.size > 1 && emailGroups.has('no_email') === false) {
            console.warn(`Multiple email groups found for ${studentIdentifier}. Possible collision that was resolved with CSVs.`);
            console.warn(`Identifier should be an email address in this case, not a name. Check your CSV resolution.`);
        }
        
        // Use the correct data to save - if this is an email-based identifier, use only entries that match the email
        let dataToSave = allEntries;
        
        // If this is an email-based identifier from collision resolution
        if (studentIdentifier.includes('@')) {
            if (emailGroups.has(studentIdentifier)) {
                dataToSave = emailGroups.get(studentIdentifier);
                console.log(`Using ${dataToSave.length} entries with matching email ${studentIdentifier} for processed_files.json`);
            } else {
                console.warn(`Email identifier ${studentIdentifier} not found in email groups. Using all entries.`);
            }
        }
        
        try {
             if (!fs.existsSync(studentOutputDir)) {
                 // It should exist from transformation, but check just in case
                 console.warn(`Student output directory missing during save: ${studentOutputDir}. Creating.`);
                 fs.mkdirSync(studentOutputDir, { recursive: true });
             }
             fs.writeFileSync(infoFilePath, JSON.stringify(dataToSave, null, 2));
             console.log(`  Saved info for ${studentIdentifier} to ${infoFilePath}`);
        } catch (err) {
            console.error(`  Error saving processed info for ${studentIdentifier}:`, err);
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
        console.log(`Config exported to ${filePath}`);
        return { success: true, filePath: filePath };
    } catch (error) {
        console.error(`Failed to export config to ${filePath}:`, error);
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
        console.log(`Imported config from ${filePath} and saved to ${CONFIG_PATH}`);
        
        // Return the loaded config to the renderer
        return { success: true, config: importedConfig, filePath: filePath }; 
    } catch (error) {
        console.error(`Failed to import config from ${filePath}:`, error);
        return { success: false, error: error.message };
    }
});
// --- End Config Handlers ---

// *** CORRECTED Pre-checking Collisions Handler ***
ipcMain.handle('precheck-collisions', async (event, mainDirectory, folderPattern, useCSVs = false) => {
    console.log(`IPC: Received precheck-collisions (useCSVs: ${useCSVs})`);
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
        console.log("Precheck: Parsing CSV files for email mappings");
        const csvResult = await parseCSVsInDirectory(mainDirectory);
        emailMap = csvResult.emailMappings;
        pagesWithCSV = csvResult.pagesWithCSV;
        pagesWithoutCSV = csvResult.pagesWithoutCSV;
        allPages = csvResult.allPages;
        console.log(`Precheck: Loaded ${Object.keys(emailMap).length} email mappings from CSVs`);
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
            console.log("Pre-check: No page directories found.");
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
                        console.log(`Precheck: Resolved ${studentFolder} to ${email} using CSV mapping`);
                    } else if (pageHasCsv) {
                        // *** New Check: CSV exists for this page, but no mapping for this someNumber ***
                        console.warn(`Precheck Mapping Error: Page '${pageDir}' has a CSV, but no email mapping found for someNumber '${parsedInfo.someNumber}' in folder '${studentFolder}'.`);
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
                            console.log(`Precheck: Found distinct emails for ${identifier}, not a collision`);
                            continue; // Skip this as it's not a real collision
                        }
                    }
                    
                    // Multiple different original folders map to the same identifier in this page directory
                    pageCollisions.push(identifier);
                    actualCollidingNames.add(identifier); // Track actual colliding names
                    collisionFound = true;
                    console.warn(`Pre-check Collision Detected in PAGE '${pageDir}': Identifier '${identifier}' maps to multiple original folders: ${folders.map(f => f.folderName).join(', ')}`);
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
            console.log("Checking for partial CSV coverage issues...");
            
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
                console.warn(`Partial CSV coverage detected! Missing CSV in: ${missingCsvPages.join(', ')}`);
                console.warn(`Students appearing in multiple pages: ${studentsAffectedByPartialCSV.join(', ')}`);
                
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
            
            console.log(`IPC: Pre-check finished. Collisions: ${collisionFound}, Mapping Errors: ${mappingErrorFound}. Colliding names: ${uniqueCollidingNames.join(', ')}. Mapping errors count: ${mappingErrors.length}`);
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
            console.log("IPC: Pre-check found no name collisions or mapping errors within any page directory.");
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
        console.error("IPC: Error during precheck-collisions:", error);
        throw error;
    }
});