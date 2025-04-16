const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

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

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 650,
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
        primaryIdentifier: folderName, // Default to full folder name
        firstName: '',
        lastName: '',
        studentNumber: '',
        username: '',
        fullName: folderName // Store original as fallback full name
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
        // Now split the baseName by the detected separator IF it exists, otherwise assume it might be just name_number
        const nameAndNumber = separator ? baseName.split(separator) : baseName.split('_'); // Fallback to _ for Moodle
        
        if (nameAndNumber.length >= 2) {
            result.fullName = nameAndNumber.slice(0, -1).join(separator || '_'); // Re-join with correct separator
            const nameComponents = result.fullName.trim().split(/\s+/);
            result.lastName = nameComponents.pop() || result.fullName;
            result.firstName = nameComponents.join(' ') || '';
            // Update primaryIdentifier for Moodle case
            result.primaryIdentifier = result.fullName;
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

// Function to prepare transformations and handle ambiguities (MOVED HERE)
async function prepareTransformations(mainDirectory, outputDirectory, folderPattern) {
    console.log("Preparing transformations...");
    
    if (!fs.existsSync(mainDirectory)) {
        throw new Error(`Input directory does not exist: ${mainDirectory}`);
    }
    
    if (!fs.existsSync(outputDirectory)) {
        console.log(`Creating output directory: ${outputDirectory}`);
        fs.mkdirSync(outputDirectory, { recursive: true });
    }
    
    // Process main directory structure, expecting subdirectories for pages
    const pageDirs = fs.readdirSync(mainDirectory).filter(item => {
        const itemPath = path.join(mainDirectory, item);
        return fs.statSync(itemPath).isDirectory();
    });
    
    console.log(`Found ${pageDirs.length} page directories: ${pageDirs.join(', ')}`);
    
    if (pageDirs.length === 0) {
        throw new Error('No page directories found in the input directory.');
    }
    
    const transformationTasks = [];
    const ambiguities = [];
    
    // Iterate through page directories
    for (const pageDir of pageDirs) {
        const pageDirPath = path.join(mainDirectory, pageDir);
        console.log(`Processing page directory: ${pageDirPath}`);
        
        // Find student folders within each page directory
        const studentFolders = fs.readdirSync(pageDirPath).filter(item => {
            const itemPath = path.join(pageDirPath, item);
            return fs.statSync(itemPath).isDirectory();
        });
        
        console.log(`Found ${studentFolders.length} student folders in page '${pageDir}'`);
        
        // Process each student folder
        for (const studentFolder of studentFolders) {
            const studentFolderPath = path.join(pageDirPath, studentFolder);
            console.log(`Processing student folder: ${studentFolderPath}`);
            
            // Find files that could be valid inputs (PDF, PNG, JPG, HEIC)
            const validFiles = fs.readdirSync(studentFolderPath).filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.pdf', '.png', '.jpg', '.jpeg', '.heic'].includes(ext);
            });
            
            console.log(`Found ${validFiles.length} valid files in student folder '${studentFolder}'`);
            
            if (validFiles.length === 0) {
                console.warn(`No valid files found in folder: ${studentFolderPath}`);
                continue;
            }
            
            // Use the folder name pattern for parsing - CALL LOCAL FUNCTION
            const parsedInfo = parseFolderName(studentFolder, folderPattern);
            const studentIdentifier = parsedInfo.primaryIdentifier;
            
            // Create student output directory INSIDE 'pages'
            const studentOutputDir = path.join(outputDirectory, 'pages', studentIdentifier);
            if (!fs.existsSync(studentOutputDir)) {
                fs.mkdirSync(studentOutputDir, { recursive: true });
            }
            
            const outputFilePath = path.join(studentOutputDir, `${pageDir}.pdf`);
            
            if (validFiles.length === 1) {
                // Simple case - only one valid file
                const inputFile = validFiles[0];
                const originalFileName = inputFile; // Store the original filename
                const inputPath = path.join(studentFolderPath, inputFile);
                
                transformationTasks.push({
                    inputPath,
                    outputPath: outputFilePath,
                    pageName: pageDir,
                    originalFileName,
                    studentInfo: parsedInfo
                });
            } else {
                // Ambiguity case - multiple valid files
                ambiguities.push({
                    folderPath: studentFolderPath,
                    files: validFiles,
                    context: `Student: ${studentFolder}, Page: ${pageDir}`
                });
            }
        }
    }
    
    console.log(`Preparation complete. Tasks: ${transformationTasks.length}, Ambiguities: ${ambiguities.length}`);
    return { tasks: transformationTasks, ambiguities };
}


ipcMain.handle('start-transformation', async (event, mainDirectory, outputDirectory, templatePath, dpi) => {
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
    const folderPattern = config.foldernamePattern; // Get pattern from config
    console.log("Using folder pattern:", folderPattern);

    try {
        // Call the local prepareTransformations function
        const { tasks, ambiguities } = await prepareTransformations(mainDirectory, outputDirectory, folderPattern);
        console.log(`IPC: Transformation preparation complete. Tasks: ${tasks.length}, Ambiguities: ${ambiguities.length}`);

        // Store data for potential later resolution
        pendingTransformationData = { 
            unambiguousTasks: tasks, 
            ambiguities: ambiguities,
            outputDirectory: outputDirectory // Keep storing here too for now, might be needed elsewhere
        }; 

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
            console.log("IPC: No ambiguities. Processing tasks directly.");
            let successCount = 0;
            let errorCount = 0;
            const totalTasks = tasks.length;

            for (let i = 0; i < totalTasks; i++) {
                const task = tasks[i];
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
                        studentInfo: task.studentInfo // Store the full parsed info
                    });
                    // --- End Store --- 
                } catch (processingError) {
                    console.error(`Error during initial transformation for ${task.inputPath}:`, processingError);
                    errorCount++;
                }
            }
            // --- Save processed info after loop --- 
            console.log(`IPC: About to save processed info, currentOutputDirectory = ${currentOutputDirectory}`); // Log the value
            await saveProcessedFileInfo(currentOutputDirectory);
            // --- End Save ---
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
         // Handle errors from prepareTransformations (like name collision) or re-thrown ambiguity message
        console.error("IPC: Error during transformation start:", error);
        throw error; // Re-throw to be sent to the renderer
    }
});

ipcMain.handle('resolve-ambiguity', async (event, resolvedChoices) => {
    console.log("IPC: Received resolve-ambiguity with choices:", resolvedChoices);
    
    if (!pendingTransformationData || !pendingTransformationData.ambiguities || pendingTransformationData.ambiguities.length === 0) {
         console.error("IPC: Received ambiguity resolution but no pending ambiguity data found.");
         throw new Error("No pending ambiguity task found to resolve.");
    }

    // Explicitly ensure currentOutputDirectory is set from pendingTransformationData
    if (pendingTransformationData.outputDirectory) {
        currentOutputDirectory = pendingTransformationData.outputDirectory;
        console.log(`IPC: Set currentOutputDirectory to ${currentOutputDirectory}`);
    } else {
        console.error("IPC: No output directory in pendingTransformationData");
        throw new Error("Output directory information is missing");
    }

    let config = {};
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (err) {
        console.warn("Could not load config for ambiguity resolution, using defaults.");
    }
    const folderPattern = config.foldernamePattern; // Get pattern from config

    // Construct tasks from resolved ambiguities
    const resolvedTasks = [];
    const ambiguities = pendingTransformationData.ambiguities;

    for (const ambiguity of ambiguities) {
        const chosenFile = resolvedChoices[ambiguity.folderPath];
        if (!chosenFile || !ambiguity.files.includes(chosenFile)) {
            console.error(`IPC: Invalid resolution for folder ${ambiguity.folderPath}. Chosen: ${chosenFile}, Available: ${ambiguity.files.join(', ')}`);
            throw new Error(`Invalid file chosen for folder: ${ambiguity.folderPath}`);
        }

        const inputPath = path.join(ambiguity.folderPath, chosenFile);
        const studentFolder = path.basename(ambiguity.folderPath);
        const subdir = path.basename(path.dirname(ambiguity.folderPath));

        // Use the new parsing function
        const parsedInfo = parseFolderName(studentFolder, folderPattern);
        const studentIdentifier = parsedInfo.primaryIdentifier; // Use the determined identifier

        if (!studentIdentifier || !subdir) { 
             const errorMsg = `Could not determine studentIdentifier/subdir from path: ${ambiguity.folderPath}`;
             console.error("IPC: " + errorMsg);
             throw new Error(errorMsg);
        }
        
        // Use studentIdentifier for output directory INSIDE 'pages'
        const studentOutputDirectory = path.join(currentOutputDirectory, 'pages', studentIdentifier); 
        if (!fs.existsSync(studentOutputDirectory)){
            console.log(`Creating output directory during resolution: ${studentOutputDirectory}`);
            fs.mkdirSync(studentOutputDirectory, { recursive: true });
        }
        const outputPath = path.join(studentOutputDirectory, `${subdir}.pdf`);
        resolvedTasks.push({ 
            inputPath, 
            outputPath, 
            originalFileName: chosenFile,
            pageName: subdir,
            // Pass parsed info along
            studentInfo: parsedInfo 
        });
    }

    // Combine unambiguous tasks and resolved tasks
    const finalTasks = [...pendingTransformationData.unambiguousTasks, ...resolvedTasks];

    console.log(`IPC: Ambiguity resolved. Processing ${finalTasks.length} total tasks.`);
    const storedDpi = currentTransformationDpi; 
    const totalTasks = finalTasks.length;
    pendingTransformationData = null; 
    processedFileInfo = {}; // Reset processed file info before processing resolved tasks

    // Now process the combined task list
    let successCount = 0;
    let errorCount = 0;
    for (let i = 0; i < totalTasks; i++) {
        const task = finalTasks[i];
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
            await processSingleTransformation(task.inputPath, task.outputPath, storedDpi);
            successCount++;
             // --- Store processed file info ---
            // Use studentIdentifier for grouping in processedFileInfo
            const studentIdentifierForStorage = task.studentInfo?.primaryIdentifier || path.basename(path.dirname(task.outputPath));
            if (!processedFileInfo[studentIdentifierForStorage]) processedFileInfo[studentIdentifierForStorage] = [];
            processedFileInfo[studentIdentifierForStorage].push({ 
                pageName: task.pageName, 
                originalFileName: task.originalFileName,
                studentInfo: task.studentInfo // Store the full parsed info
            });
            // --- End Store ---
        } catch (processingError) {
            console.error(`Error during resolved transformation for ${task.inputPath}:`, processingError);
            errorCount++;
        }
    }
    // --- Save processed info after loop --- 
    console.log(`IPC: About to save processed info, currentOutputDirectory = ${currentOutputDirectory}`); // Keep this log for now
    // Revert to using the reliably set currentOutputDirectory
    await saveProcessedFileInfo(currentOutputDirectory);
    // --- End Save ---
    console.log(`IPC: Resolved transformation processing complete. Success: ${successCount}, Errors: ${errorCount}`);
    if (errorCount > 0) {
        throw new Error(`Transformation completed with ${errorCount} error(s) after resolution.`);
    } else {
        return `Transformation completed successfully for ${successCount} file(s) after resolution.`;
    }
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

// Modify saveProcessedFileInfo to potentially use studentInfo from the items
async function saveProcessedFileInfo(outputDirectory) {
    console.log("Saving processed file information...");
    // The outputDirectory passed here is the *root* output dir
    for (const studentIdentifier in processedFileInfo) {
        // Construct path to student directory inside 'pages'
        const studentOutputDir = path.join(outputDirectory, 'pages', studentIdentifier);
        const infoFilePath = path.join(studentOutputDir, 'processed_files.json');
        // We save the array of { pageName, originalFileName, studentInfo }
        const dataToSave = processedFileInfo[studentIdentifier]; 
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