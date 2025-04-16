// Remove the direct require of ipcRenderer
// const { ipcRenderer } = require('electron');

// Declare config at a higher scope
let config = {};

// Default Cover Template Content (Updated with user's template)
const DEFAULT_COVER_TEMPLATE = `# {{LAST_NAME}}
### {{FIRST_NAME}}

({{FULL_NAME}}, {{STUDENTNUMBER}})

### Booklet

Dieses Booklet ist zugelassenes Hilfsmittel im Wintersemester 2024 und im Sommersemester 2025.

**Eingereichte Seiten:**
{{SUBMITTED_PAGES_LIST}}

**Nicht eingereichte Seiten:**
{{MISSING_PAGES_LIST}}`;

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
window.electronAPI.onLoadConfig((loadedConfig) => {
    console.log('Received load-config:', loadedConfig); // Debug log
    // Update the higher-scoped config variable
    config = loadedConfig || {}; 
    // Update UI fields from loaded config
    if (config.mainDirectory) {
        document.getElementById('mainDirectoryPath').value = config.mainDirectory;
    }
    if (config.outputDirectory) {
        document.getElementById('outputDirectoryPath').value = config.outputDirectory;
    }
    if (config.dpi) {
        document.getElementById('dpi').value = config.dpi;
    }
    // Load foldername pattern
    if (config.foldernamePattern) {
        document.getElementById('foldername-pattern').value = config.foldernamePattern;
        
        const iliasPattern = document.getElementById('pattern-ilias').value;
        const moodlePattern = document.getElementById('pattern-moodle').value;
        
        if (config.foldernamePattern === iliasPattern) {
            document.getElementById('pattern-ilias').checked = true;
        } else if (config.foldernamePattern === moodlePattern) {
            document.getElementById('pattern-moodle').checked = true;
        } else {
            document.getElementById('pattern-custom').checked = true;
        }
    }
    // Load cover template content
    const coverTemplateTextarea = document.getElementById('coverTemplateContentInput');
    if (coverTemplateTextarea) {
        coverTemplateTextarea.value = config.coverTemplateContent || DEFAULT_COVER_TEMPLATE;
    }
});


function saveConfig() {
    // Get the current values from the UI
    config.mainDirectory = document.getElementById('mainDirectoryPath').value;
    config.outputDirectory = document.getElementById('outputDirectoryPath').value;
    config.dpi = parseInt(document.getElementById('dpi').value, 10);
    config.foldernamePattern = document.getElementById('foldername-pattern').value; // Save pattern
    
    // Save cover template content
    const coverTemplateTextarea = document.getElementById('coverTemplateContentInput');
    if (coverTemplateTextarea) {
        config.coverTemplateContent = coverTemplateTextarea.value;
    }

    // Use the exposed function to save the updated config object
    window.electronAPI.saveConfig(config);
}

window.electronAPI.onDirectorySelected((type, directoryPath) => {
    console.log(`Received directory-selected: type=${type}, path=${directoryPath}`); // Debug log
    if (type === 'mainDirectory') {
        document.getElementById('mainDirectoryPath').value = directoryPath;
        config.mainDirectory = directoryPath; // Update config too
    } else if (type === 'outputDirectory') {
        document.getElementById('outputDirectoryPath').value = directoryPath;
        config.outputDirectory = directoryPath; // Update config too
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

// --- Moodle Collision Modal Logic ---
const moodleCollisionModal = document.getElementById('moodleCollisionModal');
const collisionListDiv = document.getElementById('collisionList');
const moodleCollisionCloseBtn = moodleCollisionModal.querySelector('.moodle-collision-close');
const moodleCollisionOkBtn = document.getElementById('moodleCollisionOkBtn');
const moodleCollisionRetryWithCSVBtn = document.getElementById('moodleCollisionRetryWithCSVBtn');

// Store the directory and pattern for retry with CSV
let lastInputDirectory = '';
let lastFolderPattern = '';

function openMoodleCollisionModal(collidingNames, usedCSVs = false, csvMappingsCount = 0, partialCsvCoverage = false, missingCsvPages = [], studentsAffected = []) {
    collisionListDiv.innerHTML = ''; // Clear previous list
    
    // Create message about CSV status
    const csvStatusDiv = document.createElement('div');
    
    if (usedCSVs) {
        if (partialCsvCoverage) {
            // Warning about partial CSV coverage - more prominent styles
            csvStatusDiv.className = 'csv-status-info critical-warning';
            csvStatusDiv.innerHTML = `
                <h3>⚠️ CSV Files Missing in Some Directories</h3>
                <p>You have CSV files in some page directories but not in others. This prevents proper student matching across pages.</p>
                <p><strong>Missing CSV files in:</strong> ${missingCsvPages.join(', ')}</p>
                <p><strong>Students appearing in multiple pages:</strong> ${studentsAffected.join(', ')}</p>
                <p><strong>Action required:</strong> Please add the corresponding CSV files to <em>all</em> page directories before continuing.</p>
                <p><small>CSV files must be placed in every page directory for the tool to correctly match students across pages.</small></p>
            `;
        } else if (csvMappingsCount > 0) {
            csvStatusDiv.className = 'csv-status-info';
            csvStatusDiv.innerHTML = `<p>CSV files were used and ${csvMappingsCount} email mappings were found, but collisions still exist.</p>`;
            // Hide the retry button if we already used CSVs
            if (moodleCollisionRetryWithCSVBtn) {
                moodleCollisionRetryWithCSVBtn.style.display = 'none';
            }
        } else {
            csvStatusDiv.className = 'csv-status-info';
            csvStatusDiv.innerHTML = `<p>CSV files were checked but no valid mappings were found. Please ensure CSV files are present in each page folder with correct headers.</p>`;
            // Show the retry button in case they add CSV files
            if (moodleCollisionRetryWithCSVBtn) {
                moodleCollisionRetryWithCSVBtn.style.display = 'inline-block';
            }
        }
    } else {
        csvStatusDiv.className = 'csv-status-info';
        csvStatusDiv.innerHTML = `<p>CSV files have not been checked. If you have CSV files with email mappings in the page folders, click "Check Again After Changes".</p>`;
        // Show the retry button
        if (moodleCollisionRetryWithCSVBtn) {
            moodleCollisionRetryWithCSVBtn.style.display = 'inline-block';
        }
    }
    
    collisionListDiv.appendChild(csvStatusDiv);
    
    // Add the list of colliding names - only show this section if there are actual collisions
    if (collidingNames && collidingNames.length > 0) {
        const collisionsSection = document.createElement('div');
        collisionsSection.className = 'collision-section';
        
        const listHeader = document.createElement('h3');
        listHeader.textContent = 'Students with Same-Name Collisions:';
        collisionsSection.appendChild(listHeader);
        
        const explanation = document.createElement('p');
        explanation.innerHTML = `<small>These students have multiple entries with the same name within a single page folder.</small>`;
        collisionsSection.appendChild(explanation);
        
        const list = document.createElement('ul');
        collidingNames.forEach(name => {
            const item = document.createElement('li');
            item.textContent = name;
            list.appendChild(item);
        });
        collisionsSection.appendChild(list);
        
        collisionListDiv.appendChild(collisionsSection);
    }
    
    moodleCollisionModal.style.display = 'block';
}

function closeMoodleCollisionModal() {
    moodleCollisionModal.style.display = 'none';
}

// Handle retry with CSV files
async function retryWithCSVFiles() {
    if (!lastInputDirectory || !lastFolderPattern) {
        updateStatus('error', 'Cannot retry - missing directory or pattern information.');
        return;
    }
    
    closeMoodleCollisionModal();
    updateStatus('processing', 'Checking for changes and retrying...');
    
    try {
        const collisionResult = await window.electronAPI.precheckCollisions(lastInputDirectory, lastFolderPattern, true);
        console.log("CSV-based pre-check result:", collisionResult);
        
        if (collisionResult && collisionResult.collisionDetected) {
            updateStatus('warning', 'Name collisions still detected. Please review and try again.');
            openMoodleCollisionModal(
                collisionResult.collidingNames, 
                collisionResult.usedCSVs, 
                collisionResult.csvMappingsCount,
                collisionResult.partialCsvCoverage,
                collisionResult.missingCsvPages,
                collisionResult.studentsAffected
            );
        } else {
            // No collisions with CSV - proceed with transformation
            updateStatus('success', 'Collisions resolved! Proceeding with transformation...');
            
            // Start the actual transformation
            try {
                const dpiValue = parseInt(document.getElementById('dpi').value, 10);
                const result = await window.electronAPI.startTransformation(
                    lastInputDirectory, 
                    document.getElementById('outputDirectoryPath').value, 
                    dpiValue
                );
                
                if (result && result.status === 'ambiguity_detected') {
                    updateStatus('info', result.message);
                } else {
                    const successMessage = typeof result === 'string' ? result : 'Pages transformed successfully!';
                    updateStatus('success', successMessage);
                }
            } catch (error) {
                console.error("Error during transformation:", error);
                updateStatus('error', 'Error transforming pages: ' + error.message);
            }
        }
    } catch (precheckError) {
        console.error("Error during check:", precheckError);
        updateStatus('error', `Error checking for collisions: ${precheckError.message}`);
    }
}

moodleCollisionCloseBtn.onclick = closeMoodleCollisionModal;
moodleCollisionOkBtn.onclick = closeMoodleCollisionModal;

// Add event listener for the retry button if it exists
if (moodleCollisionRetryWithCSVBtn) {
    moodleCollisionRetryWithCSVBtn.onclick = retryWithCSVFiles;
} else {
    console.warn("CSV retry button not found in HTML. Please add it to the modal.");
}

// Also close if clicking outside
window.addEventListener('click', (event) => {
    if (event.target == moodleCollisionModal) {
        closeMoodleCollisionModal();
    }
    // ... existing click outside logic for other modals ...
    const settingsModal = document.getElementById('settingsModal');
    if (event.target == settingsModal) {
        settingsModal.style.display = "none";
        saveConfig(); // Assuming settings modal also saves on close
    }
    const coverModal = document.getElementById('coverTemplateModal');
     if (event.target == coverModal) {
         coverModal.style.display = 'none';
         saveConfig(); // Save on close
     }
    const ambiguityModal = document.getElementById('ambiguityModal');
    if (event.target == ambiguityModal) {
        // Decide if closing ambiguity modal externally should cancel or do nothing
        // For now, let the explicit close button handle it
    }
});

// --- End Moodle Collision Modal Logic ---

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
    const outputDirectory = document.getElementById('outputDirectoryPath').value;
    // templatePath is no longer needed here

    if (!mainDirectory || !outputDirectory) {
        document.getElementById('status').textContent = 'Please select input and output directories before proceeding.';
        updateStatus('error', 'Please select input and output directories.');
        return;
    }

    document.getElementById('status').textContent = 'Starting transformation process...';
    updateStatus('processing', 'Starting transformation...');
	
    const currentPattern = config.foldernamePattern; // Get pattern from current config
    const moodlePresetPattern = document.getElementById('pattern-moodle')?.value; // Get Moodle pattern value

    // --- Moodle Pre-check --- 
    if (currentPattern && moodlePresetPattern && currentPattern === moodlePresetPattern) {
        console.log("Moodle pattern selected, performing pre-check for collisions...");
        try {
            // Store for potential retry
            lastInputDirectory = mainDirectory;
            lastFolderPattern = currentPattern;
            
            const collisionResult = await window.electronAPI.precheckCollisions(mainDirectory, currentPattern);
            console.log("Pre-check result:", collisionResult);
            if (collisionResult && collisionResult.collisionDetected) {
                 updateStatus('warning', 'Potential name collisions detected. Please resolve.');
                 openMoodleCollisionModal(
                    collisionResult.collidingNames, 
                    collisionResult.usedCSVs, 
                    collisionResult.csvMappingsCount,
                    collisionResult.partialCsvCoverage,
                    collisionResult.missingCsvPages,
                    collisionResult.studentsAffected
                 );
                 return; // Stop the process, user needs to resolve
            }
            console.log("Pre-check passed, no collisions detected.");
        } catch (precheckError) {
            console.error("Error during pre-check:", precheckError);
            updateStatus('error', `Error during pre-check: ${precheckError.message}`);
            // Optionally show a more generic error modal or just update status
            return; // Stop if pre-check fails
        }
    } else {
         console.log("Non-Moodle pattern or no pattern selected, skipping pre-check.");
    }
    // --- End Moodle Pre-check --- 

    // Proceed with actual transformation if pre-check passed or wasn't needed
    document.getElementById('status').textContent = 'Transforming pages... Please wait.';
    updateStatus('processing', 'Transforming pages... Please wait.');
	
    try {
        let dpiValue = parseInt(document.getElementById('dpi').value, 10);
        const result = await window.electronAPI.startTransformation(mainDirectory, outputDirectory, dpiValue); // Removed templatePath

        if (result && result.status === 'ambiguity_detected') {
             document.getElementById('status').textContent = result.message;
             updateStatus('info', result.message);
        } else {
            const successMessage = typeof result === 'string' ? result : 'Pages transformed successfully! Check the output directory.';
            document.getElementById('status').textContent = successMessage;
            updateStatus('success', successMessage);
        }
    } catch (error) {
        console.error("Error during transformation:", error);
        // Specific handling for final collision error after automatic attempt fails
        if (error.message.startsWith('FinalCollisionError:')) { 
             document.getElementById('status').textContent = error.message; // Show detailed error
             updateStatus('error', 'Unresolvable name collisions found. Please rename input folders manually.');
             // TODO: Optionally show a specific modal here too, maybe reusing parts of moodleCollisionModal structure
        } else {
            // General error handling
        document.getElementById('status').textContent = 'Error transforming pages: ' + error.message;
		updateStatus('error', 'Error transforming pages: ' + error.message);
        }
    }
});

document.getElementById('startMergingBtn').addEventListener('click', async () => {
    const mainDirectory = document.getElementById('mainDirectoryPath').value;
    const outputDirectory = document.getElementById('outputDirectoryPath').value;

    if (!mainDirectory || !outputDirectory) {
        document.getElementById('status').textContent = 'Please select input and output directories before proceeding.';
        updateStatus('error', 'Please select input and output directories.'); // Update status bar
        return;
    }

    document.getElementById('status').textContent = 'Merging PDFs... Please wait.';
    updateStatus('processing', 'Merging PDFs... Please wait.'); // Update status bar
    
    try {
        // Use the exposed function - REMOVED templatePath argument
        await window.electronAPI.startMerging(mainDirectory, outputDirectory);
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

// Add event listeners for directory selection buttons
document.getElementById('select-main-dir-button').addEventListener('click', () => {
    window.electronAPI.selectDirectory('mainDirectory');
});

document.getElementById('select-output-dir-button').addEventListener('click', () => {
    window.electronAPI.selectDirectory('outputDirectory');
});

// Add event listeners for Config Export/Import
document.getElementById('exportConfigBtn').addEventListener('click', async () => {
    console.log("Export config button clicked");
    try {
        const result = await window.electronAPI.handleExportConfig(config);
        if (result.success) {
            updateStatus('info', `Config exported to ${result.filePath}`);
        } else if (!result.cancelled) {
            updateStatus('error', `Failed to export config: ${result.error}`);
        }
    } catch (error) {
        updateStatus('error', `Error during config export: ${error.message}`);
    }
});

document.getElementById('importConfigBtn').addEventListener('click', async () => {
    console.log("Import config button clicked");
    try {
        const result = await window.electronAPI.handleImportConfig();
        if (result.success) {
            // Config loaded successfully by main process, now update UI
            // The main process should send the loaded config back via 'load-config'
            // or we refetch it here. Assuming main process saves and renderer reloads.
            // A simple reload or manual update based on result.config could work.
            config = result.config; // Assume main process returns the loaded config
            // Update UI fields from the newly loaded config
            if (config.mainDirectory) document.getElementById('mainDirectoryPath').value = config.mainDirectory;
            if (config.outputDirectory) document.getElementById('outputDirectoryPath').value = config.outputDirectory;
            if (config.dpi) document.getElementById('dpi').value = config.dpi;
            if (config.foldernamePattern) document.getElementById('foldername-pattern').value = config.foldernamePattern;
            
            saveConfig(); // Persist the newly imported config
            updateStatus('info', `Config imported successfully from ${result.filePath}`);
        } else if (!result.cancelled) {
            updateStatus('error', `Failed to import config: ${result.error}`);
        }
    } catch (error) {
        updateStatus('error', `Error during config import: ${error.message}`);
    }
});

// When the modal is closed, save the potentially updated config
document.querySelector('#settingsModal .close-button').addEventListener('click', () => {
    const settingsModal = document.getElementById('settingsModal');
    settingsModal.style.display = "none";
    saveConfig();
});

// Handle pattern preset radio buttons
document.querySelectorAll('input[name="pattern-preset"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const patternInput = document.getElementById('foldername-pattern');
        if (e.target.value !== 'custom') {
            // If a preset is selected, populate the input with the value
            patternInput.value = e.target.value;
            // Also update the config
            config.foldernamePattern = e.target.value;
        } else {
            // For custom, don't change the input value but allow user editing
            // Optionally could clear it: patternInput.value = '';
        }
    });
});

// Add event listener for the new cover template edit button
document.getElementById('editCoverTemplateBtn').addEventListener('click', () => {
    const modal = document.getElementById('coverTemplateModal');
    const textarea = document.getElementById('coverTemplateContentInput');
    // Ensure textarea is populated with current config value or default when opening
    textarea.value = config.coverTemplateContent || DEFAULT_COVER_TEMPLATE;
    modal.style.display = 'block';
});

// Add event listener for the close button on the cover template modal
document.querySelector('#coverTemplateModal .cover-template-close').addEventListener('click', () => {
    const modal = document.getElementById('coverTemplateModal');
    modal.style.display = 'none';
    // Save config when closing the modal
    saveConfig();
});



