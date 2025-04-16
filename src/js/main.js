const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');


const { mergeStudentPDFs, transformAndMergeStudentPDFs, createSaddleStitchBooklet } = require('./pdf-merger');




function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 580,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    win.loadFile(path.join(__dirname, '../../index.html'));

    // Check if config exists and send its content to renderer
    if (fs.existsSync(CONFIG_PATH)) {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH));
        win.webContents.on('did-finish-load', () => {
            win.webContents.send('load-config', config);
        });
    }

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

    if (type === 'descriptionFile') {
        dialogOptions = {
            properties: ['openFile'],
            filters: [{ name: 'Text Files', extensions: ['txt'] }]
        };
    }

    const result = await dialog.showOpenDialog(dialogOptions);

    if (!result.canceled && result.filePaths.length > 0) {
        event.sender.send('directory-selected', type, result.filePaths[0]);
    }
});


ipcMain.handle('start-transformation', async (event, mainDirectory, outputDirectory, descriptionFilePath, dpi) => {
    try {
        await transformAndMergeStudentPDFs(mainDirectory, outputDirectory, descriptionFilePath, dpi);
    } catch (error) {
        console.error("Error during transformation:", error);
        throw error;
    }
});

ipcMain.handle('start-merging', async (event, mainDirectory, outputDirectory, descriptionFilePath) => {
    try {
        await mergeStudentPDFs(mainDirectory, outputDirectory, descriptionFilePath);
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

