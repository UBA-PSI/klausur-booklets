// Preload script for context isolation

console.log('Preload script loaded.');

const { contextBridge, ipcRenderer } = require('electron');

// Define the functions to expose to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer -> Main (send/invoke)
  selectDirectory: (type) => ipcRenderer.send('select-directory', type),
  saveConfig: (config) => ipcRenderer.send('save-config', config),
  startTransformation: (mainDir, outputDir, dpi) => ipcRenderer.invoke('start-transformation', mainDir, outputDir, dpi),
  startMerging: (mainDir, outputDir) => ipcRenderer.invoke('start-merging', mainDir, outputDir),
  createBooklets: (outputDir) => ipcRenderer.invoke('create-booklets', outputDir),
  resolveAmbiguity: (resolvedChoices) => ipcRenderer.invoke('resolve-ambiguity', resolvedChoices),
  handleExportConfig: (config) => ipcRenderer.invoke('handle-export-config', config),
  handleImportConfig: () => ipcRenderer.invoke('handle-import-config'),
  precheckCollisions: (mainDir, pattern, useCSVs) => ipcRenderer.invoke('precheck-collisions', mainDir, pattern, useCSVs),

  // Main -> Renderer (receive)
  onDirectorySelected: (callback) => ipcRenderer.on('directory-selected', (_event, type, path) => callback(type, path)),
  onLoadConfig: (callback) => ipcRenderer.on('load-config', (_event, config) => callback(config)),
  onNameCollision: (callback) => ipcRenderer.on('name-collision', (_event, message) => callback(message)),
  onAmbiguityRequest: (callback) => ipcRenderer.on('request-ambiguity-resolution', (_event, ambiguities) => callback(ambiguities)),
  onTransformationProgress: (callback) => ipcRenderer.on('transformation-progress', (_event, progressData) => callback(progressData)),

  // Listener for logs from main process
  onLogError: (callback) => ipcRenderer.on('error-log', (_event, message) => callback(message)),

  // Function to remove listeners if needed (optional but good practice)
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

  // Function to clear output
  clearOutputFolder: (outputDir) => ipcRenderer.invoke('clear-output-folder', outputDir)
});

console.log('electronAPI exposed on window object.'); 