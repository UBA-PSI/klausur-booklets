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

// Updated updateStatus function
function updateStatus(type, message) {
    const statusBar = document.getElementById('status-bar');
    const statusMessage = document.getElementById('status-message'); // Main message span
    const progressCount = document.getElementById('progress-count');
    const progressPercent = document.getElementById('progress-percent');

    // Reset status bar class
    statusBar.className = '';
    statusBar.classList.add(type);

    // Set main message
    statusMessage.textContent = message;

    // Clear progress fields if not a processing status, otherwise keep them
    if (type !== 'processing') {
        progressCount.textContent = '';
        progressPercent.textContent = '';
    } else {
        // If just setting a general processing message without progress data,
        // clear the specific progress fields.
        // The onTransformationProgress listener will fill them when data arrives.
        if (!message.includes('%')) { // Basic check if it's a progress message
             progressCount.textContent = '';
             progressPercent.textContent = '';
        }
    }
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

// --- Ambiguity Resolution Logic ---
const ambiguityModal = document.getElementById('ambiguityModal');
const ambiguityListDiv = document.getElementById('ambiguityList');
const ambiguityCloseBtn = ambiguityModal.querySelector('.ambiguity-close');
const confirmAmbiguityBtn = document.getElementById('confirmAmbiguityBtn');
const ambiguityErrorDiv = document.getElementById('ambiguityError');
const ambiguityPrevBtn = document.getElementById('ambiguityPrevBtn');
const ambiguityNextBtn = document.getElementById('ambiguityNextBtn');
const ambiguityProgressDiv = document.getElementById('ambiguityProgress');

let currentAmbiguities = []; // Full list of ambiguities
let currentAmbiguityIndex = 0; // Index of the one currently displayed
let resolvedChoices = {}; // Store choices as user progresses

// Function to display the ambiguity item at the current index
function displayCurrentAmbiguity() {
    ambiguityListDiv.innerHTML = ''; // Clear previous item
    ambiguityErrorDiv.textContent = ''; // Clear error

    if (currentAmbiguityIndex < 0 || currentAmbiguityIndex >= currentAmbiguities.length) {
        console.error("Invalid ambiguity index:", currentAmbiguityIndex);
        // Handle error - maybe close modal?
        ambiguityModal.style.display = 'none';
        return;
    }

    const item = currentAmbiguities[currentAmbiguityIndex];
    const itemDiv = document.createElement('div');
    itemDiv.className = 'ambiguity-item';
    itemDiv.dataset.folderPath = item.folderPath; // Store folder path

    const title = document.createElement('h4');
    title.textContent = item.context || item.folderPath; // Use context if available
    itemDiv.appendChild(title);

    item.files.forEach((file, fileIndex) => {
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `ambiguity-${currentAmbiguityIndex}`; // Unique name per item
        radio.value = file;
        
        // Check if there's a previously stored choice for this item
        if (resolvedChoices[item.folderPath] === file) {
            radio.checked = true;
        } else if (!resolvedChoices[item.folderPath] && fileIndex === 0) {
             radio.checked = true; // Default check first if no choice stored yet
        }

        label.appendChild(radio);
        label.appendChild(document.createTextNode(` ${file}`));
        itemDiv.appendChild(label);
    });
    ambiguityListDiv.appendChild(itemDiv);

    // Update progress indicator
    ambiguityProgressDiv.textContent = `Conflict ${currentAmbiguityIndex + 1} of ${currentAmbiguities.length}`;

    // Update button states
    ambiguityPrevBtn.disabled = (currentAmbiguityIndex === 0);
    ambiguityNextBtn.style.display = (currentAmbiguityIndex === currentAmbiguities.length - 1) ? 'none' : 'inline-block';
    confirmAmbiguityBtn.style.display = (currentAmbiguityIndex === currentAmbiguities.length - 1) ? 'inline-block' : 'none';
}

// Function to store the current selection before moving
function storeCurrentSelection() {
    const currentItemDiv = ambiguityListDiv.querySelector('.ambiguity-item');
    if (currentItemDiv) {
        const folderPath = currentItemDiv.dataset.folderPath;
        const selectedRadio = currentItemDiv.querySelector('input[type="radio"]:checked');
        if (selectedRadio) {
            resolvedChoices[folderPath] = selectedRadio.value;
            console.log(`Stored choice for ${folderPath}: ${selectedRadio.value}`);
        } else {
            console.warn(`No selection found for ${folderPath} when trying to store.`);
            // Decide if we should prevent navigation or just proceed without storing
        }
    }
}

// Listener for ambiguity request from main process
window.electronAPI.onAmbiguityRequest((ambiguities) => {
    console.log("Renderer: Received request-ambiguity-resolution", ambiguities);
    if (!Array.isArray(ambiguities) || ambiguities.length === 0) {
        console.error("Renderer: Invalid ambiguity data received.");
        updateStatus('error', 'Internal error: Invalid ambiguity data.');
        return;
    }
    
    currentAmbiguities = ambiguities; 
    currentAmbiguityIndex = 0; // Start from the first item
    resolvedChoices = {}; // Reset stored choices
    
    displayCurrentAmbiguity(); // Display the first item
    ambiguityModal.style.display = 'block'; // Show the modal
});

// Previous Button Handler
ambiguityPrevBtn.onclick = function() {
    if (currentAmbiguityIndex > 0) {
        storeCurrentSelection(); // Store choice before moving
        currentAmbiguityIndex--;
        displayCurrentAmbiguity();
    }
};

// Next Button Handler
ambiguityNextBtn.onclick = function() {
    if (currentAmbiguityIndex < currentAmbiguities.length - 1) {
        storeCurrentSelection(); // Store choice before moving
        currentAmbiguityIndex++;
        displayCurrentAmbiguity();
    }
};


// Close button for ambiguity modal
ambiguityCloseBtn.onclick = function() {
    ambiguityModal.style.display = "none";
    updateStatus('info', 'Ambiguity resolution cancelled by user.');
    // Reset state if needed
    currentAmbiguities = [];
    resolvedChoices = {};
}

// Confirm button for ambiguity modal (now only shown at the end)
confirmAmbiguityBtn.onclick = async function() {
    storeCurrentSelection(); // Store the choice for the last item

    // Basic validation: Ensure a choice exists for every ambiguity
    if (Object.keys(resolvedChoices).length !== currentAmbiguities.length) {
         ambiguityErrorDiv.textContent = 'Please ensure a selection is made for all items.';
         console.error("Validation failed: Mismatch between choices and ambiguities.", resolvedChoices, currentAmbiguities);
         return;
    }
    // Can add more specific checks if needed

    ambiguityErrorDiv.textContent = ''; // Clear error
    console.log("Renderer: Sending final resolved choices:", resolvedChoices);
    updateStatus('processing', 'Processing with selected files...');
    ambiguityModal.style.display = "none"; // Hide modal

    try {
        // Send final resolved choices back to main process
        const resultMessage = await window.electronAPI.resolveAmbiguity(resolvedChoices);
        document.getElementById('status').textContent = resultMessage;
        updateStatus('success', resultMessage);
    } catch (error) {
        document.getElementById('status').textContent = 'Error after resolving ambiguity: ' + error.message;
        updateStatus('error', 'Error after resolving ambiguity: ' + error.message);
    }
}

// --- Listener for Progress Updates ---
window.electronAPI.onTransformationProgress((progressData) => {
    // { current: number, total: number, percentage: number, fileName: string }
    const countText = `${progressData.current}/${progressData.total}`;
    const percentText = `${progressData.percentage}%`;
    const fileText = `Processing ${progressData.fileName}...`;

    const statusBar = document.getElementById('status-bar');
    const statusMessage = document.getElementById('status-message');
    const progressCount = document.getElementById('progress-count');
    const progressPercent = document.getElementById('progress-percent');

    // Set status bar type
    statusBar.className = ''; // Reset
    statusBar.classList.add('processing');

    // Update individual parts
    progressCount.textContent = countText;
    progressPercent.textContent = percentText;
    statusMessage.textContent = fileText;

    // Optionally update the main status div too
    // document.getElementById('status').textContent = fileText;
});
// --- End Progress Listener ---

// --- End Ambiguity Resolution Logic ---

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
        const result = await window.electronAPI.startTransformation(mainDirectory, outputDirectory, descriptionFile, dpiValue);

        // Check if the result indicates ambiguity was detected and resolution requested
        if (result && result.status === 'ambiguity_detected') {
             document.getElementById('status').textContent = result.message; // Show the info message
             updateStatus('info', result.message); // Use 'info' status type
        } else {
            // Assume success if no ambiguity status (or handle other potential non-error statuses)
            const successMessage = typeof result === 'string' ? result : 'Pages transformed successfully! Check the student directories.';
            document.getElementById('status').textContent = successMessage;
            updateStatus('success', successMessage);
        }
    } catch (error) {
        // Catch actual errors thrown (like name collision, file system errors, or errors *after* ambiguity resolution)
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



