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
  clearOutputFolder: (outputDir) => ipcRenderer.invoke('clear-output-folder', outputDir),
  // --- New APIs for MBZ Batch Creator --- 
  showOpenDialog: (options) => ipcRenderer.invoke('dialog:showOpenDialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSaveDialog', options),
  showMessageBox: (options) => ipcRenderer.invoke('dialog:showMessageBox', options),
  pathBasename: (filePath) => ipcRenderer.invoke('path:basename', filePath),
  pathDirname: (filePath) => ipcRenderer.invoke('path:dirname', filePath),
  createBatchAssignments: (options) => ipcRenderer.invoke('mbz:createBatchAssignments', options),
  getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),
  loadMbzCreatorHtml: () => ipcRenderer.invoke('load-mbz-creator-html'),
  // --- End New APIs ---

  // Main -> Renderer (receive)
  onDirectorySelected: (callback) => ipcRenderer.on('directory-selected', (_event, type, path) => callback(type, path)),
  onLoadConfig: (callback) => ipcRenderer.on('load-config', (_event, config) => callback(config)),
  onNameCollision: (callback) => ipcRenderer.on('name-collision', (_event, message) => callback(message)),
  onAmbiguityRequest: (callback) => ipcRenderer.on('request-ambiguity-resolution', (_event, ambiguities) => callback(ambiguities)),
  onTransformationProgress: (callback) => ipcRenderer.on('transformation-progress', (_event, progressData) => callback(progressData)),

  // Listener for logs from main process
  onLogError: (callback) => ipcRenderer.on('error-log', (_event, message) => callback(message)),
  // Listener for general process logs from main process
  onProcessLog: (callback) => ipcRenderer.on('process-log', (_event, message) => callback(message)),

  // Function to remove listeners if needed (optional but good practice)
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

  // Function to clear output
  clearOutputFolder: (outputDir) => ipcRenderer.invoke('clear-output-folder', outputDir)
});

console.log('electronAPI exposed on window object.'); 