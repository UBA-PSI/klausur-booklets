const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // Warning: Setting nodeIntegration to true and contextIsolation to false is insecure.
      // Consider using a preload script and contextBridge for production apps.
      // See: https://www.electronjs.org/docs/latest/tutorial/security
      nodeIntegration: true,
      contextIsolation: false,
      // preload: path.join(__dirname, 'preload.js') // Example if using preload script
    }
  });

  mainWindow.loadFile('index.html');

  // Open the DevTools (optional) - Commented out now that it's working
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Handle PDF rasterization request from renderer process
// Receives an object { imageBuffer: Buffer, width: number, height: number }
ipcMain.handle('rasterize-pdf', async (event, { imageBuffer, width, height }) => {
  if (!imageBuffer || typeof imageBuffer !== 'object' || typeof imageBuffer.length !== 'number' || !width || !height) {
    console.error('Invalid data received from renderer (expected buffer-like object, width, height).');
    return { success: false, message: 'Invalid data received.' };
  }

  const finalBuffer = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(Uint8Array.from(Object.values(imageBuffer)));

  try {
    const expectedSize = width * height * 4;
    if (finalBuffer.length !== expectedSize) {
      throw new Error(`Pixel data buffer size mismatch. Expected ${expectedSize}, got ${finalBuffer.length}`);
    }

    const { canceled, filePath: savePath } = await dialog.showSaveDialog({
      title: 'Save Rasterized PDF Page',
      defaultPath: 'rasterized-page.png',
      filters: [{ name: 'Images', extensions: ['png'] }]
    });

    if (canceled || !savePath) {
      return { success: false, message: 'Save cancelled.' };
    }

    await sharp(finalBuffer, { 
      raw: {
        width: width,
        height: height,
        channels: 4 
      }
    })
    .png()
    .toFile(savePath);

    console.log(`Saved rasterized image to: ${savePath}`);
    return { success: true, filePath: savePath };

  } catch (error) {
    console.error('Rasterization failed in main process:', error);
    dialog.showErrorBox('Rasterization Error', `Failed to save rasterized image: ${error.message}`);
    return { success: false, message: error.message };
  }
}); 