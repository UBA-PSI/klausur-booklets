const { ipcRenderer } = require('electron');

function selectDirectory(type) {
    ipcRenderer.send('select-directory', type);
}


function updateStatus(type, message) {
    const statusBar = document.getElementById('status-bar');
    const statusIcon = document.getElementById('status-icon');
    const statusMessage = document.getElementById('status-message');

    // Reset classes
    statusBar.className = '';

    // Set the new status
    statusBar.classList.add(type);
    statusMessage.textContent = message;
}

// Example usage:
// updateStatus('success', 'Operation completed successfully.');
// updateStatus('error', 'An error occurred while processing.');
// updateStatus('processing', 'Processing your request...');




ipcRenderer.on('load-config', (event, config) => {
    if (config.mainDirectory) {
        document.getElementById('mainDirectoryPath').value = config.mainDirectory;
    }
    if (config.outputDirectory) {
        document.getElementById('outputDirectoryPath').value = config.outputDirectory;
    }
    if (config.descriptionFile) {
        document.getElementById('descriptionFilePath').value = config.descriptionFile;
    }
	
    if (config.dpi) {
        document.getElementById('dpi').value = config.dpi;
    }
});


function saveConfig() {
    ipcRenderer.send('save-config', {
        mainDirectory: document.getElementById('mainDirectoryPath').value,
        outputDirectory: document.getElementById('outputDirectoryPath').value,
        descriptionFile: document.getElementById('descriptionFilePath').value,
		dpi: parseInt(document.getElementById('dpi').value, 10)
    });
}

ipcRenderer.on('directory-selected', (event, type, directoryPath) => {
    if (type === 'mainDirectory') {
        document.getElementById('mainDirectoryPath').value = directoryPath;
    } else if (type === 'outputDirectory') {
        document.getElementById('outputDirectoryPath').value = directoryPath;
    } else if (type === 'descriptionFile') {
        document.getElementById('descriptionFilePath').value = directoryPath;
    }

    // Save the configuration
    saveConfig();
});

ipcRenderer.on('name-collision', (event, errorMessage) => {
    document.getElementById('status').textContent = errorMessage;
});




document.getElementById('startTransformationBtn').addEventListener('click', async () => {
    const mainDirectory = document.getElementById('mainDirectoryPath').value;
    const outputDirectory = document.getElementById('outputDirectoryPath').value;  // Ensure it's inside the event listener
    const descriptionFile = document.getElementById('descriptionFilePath').value;

    if (!mainDirectory || !outputDirectory || !descriptionFile) {
        document.getElementById('status').textContent = 'Please select all required paths before proceeding.';
        return;
    }

    document.getElementById('status').textContent = 'Transforming pages... Please wait.';
    updateStatus('processing', 'Transforming pages... Please wait.');
	
    try {
        let dpiValue = parseInt(document.getElementById('dpi').value, 10);
        await ipcRenderer.invoke('start-transformation', mainDirectory, outputDirectory, descriptionFile, dpiValue);
        document.getElementById('status').textContent = 'Pages transformed successfully! Check the student directories.';
        updateStatus('success', 'Pages transformed successfully! Check the student directories.');
    } catch (error) {
        document.getElementById('status').textContent = 'Error transforming pages: ' + error.message;
		updateStatus('error', 'Error transforming pages: ' + error.message);
    }
});

document.getElementById('startMergingBtn').addEventListener('click', async () => {
    const mainDirectory = document.getElementById('mainDirectoryPath').value;
    const outputDirectory = document.getElementById('outputDirectoryPath').value;
    const descriptionFile = document.getElementById('descriptionFilePath').value;

    if (!mainDirectory || !outputDirectory || !descriptionFile) {
        document.getElementById('status').textContent = 'Please select all required paths before proceeding.';
        return;
    }

    document.getElementById('status').textContent = 'Merging PDFs... Please wait.';
    
    try {
        await ipcRenderer.invoke('start-merging', mainDirectory, outputDirectory, descriptionFile);
        document.getElementById('status').textContent = 'PDFs merged successfully! Check the output directory.';
    } catch (error) {
        document.getElementById('status').textContent = 'Error merging PDFs: ' + error.message;
    }
});

document.getElementById('createBookletsBtn').addEventListener('click', async () => {
    const outputDirectory = document.getElementById('outputDirectoryPath').value;

    if (!outputDirectory) {
        document.getElementById('status').textContent = 'Please select the output directory before proceeding.';
        return;
    }

    document.getElementById('status').textContent = 'Creating booklets... Please wait.';
    
    try {
        await ipcRenderer.invoke('create-booklets', outputDirectory);
        document.getElementById('status').textContent = 'Booklets created successfully! Check the booklets directory.';
    } catch (error) {
        document.getElementById('status').textContent = 'Error creating booklets: ' + error.message;
    }
});



document.getElementById('settingsButton').addEventListener('click', openModal);

// When the modal is closed, save the DPI value
document.querySelector('.close-button').addEventListener('click', () => {
    saveConfig();
});



