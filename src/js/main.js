const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

// Updated require to include new functions and error
const {
    mergeStudentPDFs,
    prepareTransformations,       
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
        // You can add more menus like Edit, Window, Help etc.
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
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
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


ipcMain.handle('start-transformation', async (event, mainDirectory, outputDirectory, templatePath, dpi) => {
    console.log("IPC: Received start-transformation");
    pendingTransformationData = null; 
    currentTransformationDpi = dpi;   
    currentOutputDirectory = outputDirectory;
    processedFileInfo = {}; 

    try {
        const { tasks, ambiguities } = await prepareTransformations(mainDirectory, outputDirectory);
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
                    const studentName = path.basename(path.dirname(task.outputPath));
                    if (!processedFileInfo[studentName]) processedFileInfo[studentName] = [];
                    processedFileInfo[studentName].push({ 
                        pageName: task.pageName, 
                        originalFileName: task.originalFileName 
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
        const parts = ambiguity.folderPath.split(path.sep);
        const studentFolder = parts[parts.length - 1] || ''; 
        const subdir = parts[parts.length - 2] || '';      
        const studentName = studentFolder.split('_')[0];

        if (!studentName || !subdir || !pendingTransformationData.outputDirectory) { 
             const errorMsg = `Could not determine studentName/subdir/outputDir from path: ${ambiguity.folderPath}`;
             console.error("IPC: " + errorMsg);
             throw new Error(errorMsg);
        }
        
        const studentOutputDirectory = path.join(pendingTransformationData.outputDirectory, studentName); 
        if (!fs.existsSync(studentOutputDirectory)){
            console.log(`Creating output directory during resolution: ${studentOutputDirectory}`);
            fs.mkdirSync(studentOutputDirectory, { recursive: true });
        }
        const outputPath = path.join(studentOutputDirectory, `${subdir}.pdf`);
        resolvedTasks.push({ 
            inputPath, 
            outputPath, 
            originalFileName: chosenFile,
            pageName: subdir
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
            const studentName = path.basename(path.dirname(task.outputPath));
            if (!processedFileInfo[studentName]) processedFileInfo[studentName] = [];
            processedFileInfo[studentName].push({ 
                pageName: task.pageName, 
                originalFileName: task.originalFileName 
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

ipcMain.handle('start-merging', async (event, mainDirectory, outputDirectory, templateFilePath) => {
    try {
        await mergeStudentPDFs(mainDirectory, outputDirectory, null, templateFilePath);
        return "Success";
    } catch (error) {
        if (error.message.startsWith("Name collision detected")) {
            event.sender.send('name-collision', error.message);
        }
        throw error;  // Re-throw the error to be caught in the renderer
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

// Helper function to save the processed file info
async function saveProcessedFileInfo(outputDirectory) {
    console.log("Saving processed file information...");
    for (const studentName in processedFileInfo) {
        const studentOutputDir = path.join(outputDirectory, studentName);
        const infoFilePath = path.join(studentOutputDir, 'processed_files.json');
        try {
             // Ensure directory exists (might have been created earlier, but double-check)
             if (!fs.existsSync(studentOutputDir)) {
                 fs.mkdirSync(studentOutputDir, { recursive: true });
             }
             fs.writeFileSync(infoFilePath, JSON.stringify(processedFileInfo[studentName], null, 2));
             console.log(`  Saved info for ${studentName} to ${infoFilePath}`);
        } catch (err) {
            console.error(`  Error saving processed info for ${studentName}:`, err);
        }
    }
}