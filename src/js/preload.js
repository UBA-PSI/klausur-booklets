const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Renderer -> Main (send/invoke)
    selectDirectory: (type) => ipcRenderer.send('select-directory', type),
    saveConfig: (config) => ipcRenderer.send('save-config', config),
    abortProcessing: () => ipcRenderer.invoke('abort-processing'),
    startTransformation: (mainDir, outputDir, dpi) => ipcRenderer.invoke('start-transformation', mainDir, outputDir, dpi),
    startMerging: (mainDir, outputDir) => ipcRenderer.invoke('start-merging', mainDir, outputDir),
    createBooklets: (outputDir) => ipcRenderer.invoke('create-booklets', outputDir),
    resolveAmbiguity: (resolvedChoices) => ipcRenderer.invoke('resolve-ambiguity', resolvedChoices),
    handleExportConfig: (config) => ipcRenderer.invoke('handle-export-config', config),
    handleImportConfig: () => ipcRenderer.invoke('handle-import-config'),
    precheckCollisions: (mainDir, pattern, useCSVs) => ipcRenderer.invoke('precheck-collisions', mainDir, pattern, useCSVs),
    clearOutputFolder: (outputDir) => ipcRenderer.invoke('clear-output-folder', outputDir),

    // MBZ Modifier APIs
    showOpenDialog: (options) => ipcRenderer.invoke('dialog:showOpenDialog', options),
    showSaveDialog: (options) => ipcRenderer.invoke('dialog:showSaveDialog', options),
    showMessageBox: (options) => ipcRenderer.invoke('dialog:showMessageBox', options),
    pathBasename: (filePath) => ipcRenderer.invoke('path-basename', filePath),
    pathDirname: (filePath) => ipcRenderer.invoke('path-dirname', filePath),
    parseAssignmentsFromMbz: (mbzPath) => ipcRenderer.invoke('mbz:parseAssignments', mbzPath),
    modifyMbzAssignments: (options) => ipcRenderer.invoke('mbz:modifyAssignments', options),
    getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),
    loadMbzCreatorHtml: () => ipcRenderer.invoke('load-mbz-creator-html'),
    fsExists: (filePath) => ipcRenderer.invoke('fs-exists', filePath),

    // App-level APIs
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    getAppHomepage: () => ipcRenderer.invoke('get-app-homepage'),
    selectGhostscriptExecutable: () => ipcRenderer.invoke('ghostscript:selectExecutable'),
    validateGhostscript: () => ipcRenderer.invoke('ghostscript:validate'),
    validateRegistrationList: (csvPath) => ipcRenderer.invoke('validate-registration-list', csvPath),
    refreshSortOrder: (outputDirectory) => ipcRenderer.invoke('refresh-sort-order', outputDirectory),
    getPlatform: () => ipcRenderer.invoke('get-platform'),
    openExternal: (url) => ipcRenderer.invoke('open-external-url', url),

    // Main -> Renderer (receive)
    onDirectorySelected: (callback) => ipcRenderer.on('directory-selected', (_event, type, path) => callback(type, path)),
    onLoadConfig: (callback) => ipcRenderer.on('load-config', (_event, config) => callback(config)),
    onNameCollision: (callback) => ipcRenderer.on('name-collision', (_event, message) => callback(message)),
    onAmbiguityRequest: (callback) => ipcRenderer.on('request-ambiguity-resolution', (_event, ambiguities) => callback(ambiguities)),
    onTransformationProgress: (callback) => ipcRenderer.on('transformation-progress', (_event, progressData) => callback(progressData)),
    onLogError: (callback) => ipcRenderer.on('error-log', (_event, message) => callback(message)),
    onProcessLog: (callback) => ipcRenderer.on('process-log', (_event, message) => callback(message)),
    onOpenSettingsGhostscript: (callback) => ipcRenderer.on('open-settings-ghostscript', (_event) => callback()),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
