const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');


const { mergeStudentPDFs, transformAndMergeStudentPDFs } = require('./pdf-merger');




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

/* // Temporarily disabled booklet creation
ipcMain.handle('create-booklets', async (event, outputDirectory) => {
    try {
        const pdfsDir = path.join(outputDirectory, 'pdfs');
        const bookletsDir = path.join(outputDirectory, 'booklets');

        // Ensure the booklets directory exists
        if (!fs.existsSync(bookletsDir)) {
            fs.mkdirSync(bookletsDir);
        }

        const studentPDFs = fs.readdirSync(pdfsDir).filter(f => f.endsWith('.pdf'));

        for (const pdfFile of studentPDFs) {
            const inputFilePath = path.join(pdfsDir, pdfFile);
            const outputFilePath = path.join(bookletsDir, pdfFile);

            // Call the pdfimpose command for each student's PDF
            const command = `source ${path.join(__dirname, '../../venv/bin/activate')} && pdfimpose saddle "${inputFilePath}" --output "${outputFilePath}"`;
            exec(command, (error) => {
                if (error) {
                    console.error(`Error creating booklet for ${pdfFile}:`, error);
                    throw error;
                }
            });
        }

        return 'Booklets created successfully!';
    } catch (error) {
        console.error('Error in create-booklets:', error);
        throw error;  // This will send the error back to the renderer process
    }
});
*/

