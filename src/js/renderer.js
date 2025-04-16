// Remove the direct require of ipcRenderer
// const { ipcRenderer } = require('electron');

// Check if the API is exposed
if (!window.electronAPI) {
  console.error("FATAL: Preload script did not expose electronAPI!");
  // Handle the error appropriately, maybe show a message to the user
}

function selectDirectory(type) {
    // Use the exposed function
    window.electronAPI.selectDirectory(type);
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




// --- Setup Listeners using electronAPI --- 
window.electronAPI.onLoadConfig((config) => {
    console.log('Received load-config:', config); // Debug log
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
    // Use the exposed function
    window.electronAPI.saveConfig({
        mainDirectory: document.getElementById('mainDirectoryPath').value,
        outputDirectory: document.getElementById('outputDirectoryPath').value,
        descriptionFile: document.getElementById('descriptionFilePath').value,
        dpi: parseInt(document.getElementById('dpi').value, 10)
    });
}

window.electronAPI.onDirectorySelected((type, directoryPath) => {
    console.log(`Received directory-selected: type=${type}, path=${directoryPath}`); // Debug log
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

window.electronAPI.onNameCollision((errorMessage) => {
    console.log(`Received name-collision: ${errorMessage}`); // Debug log
    document.getElementById('status').textContent = errorMessage;
    updateStatus('error', errorMessage); // Update status bar too
});
// --- End Listener Setup ---


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
        // Use the exposed function
        await window.electronAPI.startTransformation(mainDirectory, outputDirectory, descriptionFile, dpiValue);
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
        // Use the exposed function
        await window.electronAPI.startMerging(mainDirectory, outputDirectory, descriptionFile);
        document.getElementById('status').textContent = 'PDFs merged successfully! Check the output directory.';
        updateStatus('success', 'PDFs merged successfully! Check the output directory.');
    } catch (error) {
        document.getElementById('status').textContent = 'Error merging PDFs: ' + error.message;
        updateStatus('error', 'Error merging PDFs: ' + error.message);
    }
});

// Re-enable the booklet creation listener and use the bridged API
document.getElementById('createBookletsBtn').addEventListener('click', async () => {
    const outputDirectory = document.getElementById('outputDirectoryPath').value;

    if (!outputDirectory) {
        document.getElementById('status').textContent = 'Please select the output directory before proceeding.';
        updateStatus('error', 'Please select the output directory before proceeding.');
        return;
    }

    document.getElementById('status').textContent = 'Creating booklets... Please wait.';
    updateStatus('processing', 'Creating booklets... Please wait.');
    
    try {
        // Use the exposed function from preload script
        const resultMessage = await window.electronAPI.createBooklets(outputDirectory);
        document.getElementById('status').textContent = resultMessage; // Display message from main process
        updateStatus('success', resultMessage);
    } catch (error) {
        document.getElementById('status').textContent = 'Error creating booklets: ' + error.message;
        updateStatus('error', 'Error creating booklets: ' + error.message);
    }
});

document.getElementById('settingsButton').addEventListener('click', openModal);

// When the modal is closed, save the DPI value
document.querySelector('.close-button').addEventListener('click', () => {
    saveConfig();
});



