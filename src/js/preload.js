// Preload script for context isolation

console.log('Preload script loaded.');

const { contextBridge, ipcRenderer } = require('electron');

// Define the functions to expose to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer -> Main (send/invoke)
  selectDirectory: (type) => ipcRenderer.send('select-directory', type),
  saveConfig: (config) => ipcRenderer.send('save-config', config),
  startTransformation: (mainDir, outputDir, descFile, dpi) => ipcRenderer.invoke('start-transformation', mainDir, outputDir, descFile, dpi),
  startMerging: (mainDir, outputDir, descFile) => ipcRenderer.invoke('start-merging', mainDir, outputDir, descFile),
  createBooklets: (outputDir) => ipcRenderer.invoke('create-booklets', outputDir),
  resolveAmbiguity: (resolvedChoices) => ipcRenderer.invoke('resolve-ambiguity', resolvedChoices),
  handleExportConfig: (config) => ipcRenderer.invoke('handle-export-config', config),
  handleImportConfig: () => ipcRenderer.invoke('handle-import-config'),

  // Main -> Renderer (receive)
  onDirectorySelected: (callback) => ipcRenderer.on('directory-selected', (_event, type, path) => callback(type, path)),
  onLoadConfig: (callback) => ipcRenderer.on('load-config', (_event, config) => callback(config)),
  onNameCollision: (callback) => ipcRenderer.on('name-collision', (_event, message) => callback(message)),
  onAmbiguityRequest: (callback) => ipcRenderer.on('request-ambiguity-resolution', (_event, ambiguities) => callback(ambiguities)),
  onTransformationProgress: (callback) => ipcRenderer.on('transformation-progress', (_event, progressData) => callback(progressData)),

  // Function to remove listeners if needed (optional but good practice)
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

console.log('electronAPI exposed on window object.'); 