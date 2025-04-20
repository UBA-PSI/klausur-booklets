// Remove the direct require of ipcRenderer
// const { ipcRenderer } = require('electron');

// Declare config at a higher scope
let config = {};

// Default Cover Template Content (Updated with user's template)
const DEFAULT_COVER_TEMPLATE = `# {{LAST_NAME}}
### {{FIRST_NAME}}

{{FULL_NAME}} ({{STUDENTNUMBER}})

### Booklet für KURSNAME

Dieses Booklet ist bei der Prüfung im Sommersemester 2025 und bei der darauffolgenden Wiederholungsprüfung ein zugelassenes Hilfsmittel. Bitte geben Sie es mit Ihrer Prüfung ab.

**Eingereichte Seiten:**
{{SUBMITTED_PAGES_LIST}}

**Nicht eingereichte Seiten:**
{{MISSING_PAGES_LIST}}`;

// Define the openModal function directly here instead of relying on modal.js
function openModal() {
    const modal = document.getElementById("settingsModal");
    if (modal) {
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
    } else {
        console.error("Settings modal element not found");
    }
}

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
    // Load filesize limits
    if (config.minFileSizeKB !== undefined) { // Check existence to avoid overwriting default
        document.getElementById('minFileSizeKB').value = config.minFileSizeKB;
    }
    if (config.maxFileSizeMB !== undefined) {
        document.getElementById('maxFileSizeMB').value = config.maxFileSizeMB;
    }
});


function saveConfig() {
    console.log('[DEBUG] saveConfig() in renderer.js called.');
    // Get the current values from the UI
    config.mainDirectory = document.getElementById('mainDirectoryPath').value;
    config.outputDirectory = document.getElementById('outputDirectoryPath').value;
    config.dpi = parseInt(document.getElementById('dpi').value, 10);
    config.foldernamePattern = document.getElementById('foldername-pattern').value; // Save pattern
    
    // Save filesize limits
    config.minFileSizeKB = parseInt(document.getElementById('minFileSizeKB').value, 10) || 0; // Default to 0 if parsing fails
    config.maxFileSizeMB = parseInt(document.getElementById('maxFileSizeMB').value, 10) || 1; // Default to 1MB if parsing fails

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

// Updated function signature to include mapping errors
function openMoodleCollisionModal(collidingNames, usedCSVs = false, csvMappingsCount = 0, partialCsvCoverage = false, missingCsvPages = [], studentsAffected = [], mappingErrors = []) { 
    const collisionListUl = document.getElementById('collisionList');
    const mappingErrorListUl = document.getElementById('mappingErrorList');
    const csvStatusDiv = document.getElementById('csvStatusInfo');
    const mappingErrorSection = document.getElementById('mappingErrorSection');
    const collisionNameSection = document.getElementById('collisionNameSection');

    // Clear previous lists
    collisionListUl.innerHTML = ''; 
    mappingErrorListUl.innerHTML = '';
    csvStatusDiv.innerHTML = ''; // Clear previous status

    let hasMappingErrors = mappingErrors && mappingErrors.length > 0;
    let hasCollisions = collidingNames && collidingNames.length > 0;

    // --- Populate CSV Status Info --- 
    let csvStatusHTML = '';
    if (partialCsvCoverage) {
        // Warning about partial CSV coverage - more prominent styles
        csvStatusHTML = `
            <h4 class="warning-heading">CSV Files Missing in Some Directories</h4>
            <p>You have CSV files in some page directories but not in others. This prevents proper student matching across pages.</p>
            <p><strong>Missing CSV files in:</strong> ${missingCsvPages.join(', ')}</p>
            <p><strong>Students potentially affected (appear in multiple pages):</strong> ${studentsAffected.join(', ') || 'None'}</p>
            <p><strong>Action required:</strong> Please add the corresponding CSV files to <em>all</em> page directories where these students appear before continuing.</p>
            <p><small>CSV files must be placed in every page directory for the tool to correctly match students across pages.</small></p>
        `;
        csvStatusDiv.className = 'csv-status-info critical-warning'; // Use critical style
    } else if (usedCSVs) {
        csvStatusHTML = `<p>CSV files were checked. ${csvMappingsCount} email mappings were loaded.</p>`;
        csvStatusDiv.className = 'csv-status-info';
    } else {
        csvStatusHTML = `<p>CSV files were not used or not found. If you have CSV files with email mappings in the page folders, place them correctly and click "Check Again After Changes".</p>`;
        csvStatusDiv.className = 'csv-status-info';
    }
    csvStatusDiv.innerHTML = csvStatusHTML;

    // --- Populate Missing CSV Mappings Section --- 
    if (hasMappingErrors) {
        mappingErrorListUl.innerHTML = ''; // Clear just in case
        mappingErrors.forEach(err => {
            const item = document.createElement('li');
            item.innerHTML = `Page: <strong>${err.pageDir}</strong>, Folder: <code>${err.studentFolder}</code> (Expected Number: ${err.someNumber})`;
            mappingErrorListUl.appendChild(item);
        });
        mappingErrorSection.style.display = 'block'; // Show the section
    } else {
        mappingErrorSection.style.display = 'none'; // Hide if no errors
    }

    // --- Populate Same-Name Collisions Section --- 
    if (hasCollisions) {
        collisionListUl.innerHTML = ''; // Clear just in case
        collidingNames.forEach(name => {
            const item = document.createElement('li');
            item.textContent = name;
            collisionListUl.appendChild(item);
        });
        collisionNameSection.style.display = 'block'; // Show the section
    } else {
        collisionNameSection.style.display = 'none'; // Hide if no collisions
    }
    
    // Show/hide the retry button based on whether CSVs were involved in the check
    if (moodleCollisionRetryWithCSVBtn) {
        moodleCollisionRetryWithCSVBtn.style.display = 'inline-block'; // Simpler: Always show retry button initially
    }

    // Show the modal using Bootstrap
    const modalEl = document.getElementById('moodleCollisionModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
}

function closeMoodleCollisionModal() {
    const modalEl = document.getElementById('moodleCollisionModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    
    // Focus a safe element before closing
    const mainView = document.getElementById('main-view');
    if (mainView) mainView.focus();
    
    if (modal) {
        modal.hide();
    } else {
        // Fallback for legacy code
        modalEl.style.display = 'none';
    }
    // Reset status bar to Ready if modal is closed without starting transformation
    updateStatus('ready', 'Ready'); 
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
        // Force using CSVs on retry
        const collisionResult = await window.electronAPI.precheckCollisions(lastInputDirectory, lastFolderPattern, true); 
        console.log("CSV-based pre-check result:", collisionResult);
        
        // Check both collisionDetected and the new mappingErrorDetected flags
        if (collisionResult && (collisionResult.collisionDetected || collisionResult.mappingErrorDetected)) { 
            updateStatus('warning', 'Issues still detected. Please review the details and try again.');
            openMoodleCollisionModal(
                collisionResult.collidingNames, 
                collisionResult.usedCSVs, 
                collisionResult.csvMappingsCount,
                collisionResult.partialCsvCoverage,
                collisionResult.missingCsvPages,
                collisionResult.studentsAffected,
                collisionResult.mappingErrors // Pass mapping errors
            );
        } else {
            // No collisions or mapping errors with CSV - proceed with transformation
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
    // Remove direct style manipulation - Bootstrap handles backdrop clicks automatically
    
    // We only need to handle legacy non-Bootstrap modals if we have any
    const moodleCollisionModal = document.getElementById('moodleCollisionModal');
    const ambiguityModal = document.getElementById('ambiguityModal');
    
    if (!moodleCollisionModal.classList.contains('fade') && event.target == moodleCollisionModal) {
        closeMoodleCollisionModal();
    }
    
    if (!ambiguityModal.classList.contains('fade') && event.target == ambiguityModal) {
        // Close ambiguity modal if clicked outside
        ambiguityCloseBtn.click();
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
    
    // Show with Bootstrap
    const modalEl = document.getElementById('ambiguityModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
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
    const modalEl = document.getElementById('ambiguityModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    
    // Focus a safe element before closing
    const mainView = document.getElementById('main-view');
    if (mainView) mainView.focus();
    
    if (modal) {
        modal.hide();
    }
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
    
    // Focus a safe element before closing
    const mainView = document.getElementById('main-view');
    if (mainView) mainView.focus();
    
    // Hide with Bootstrap
    const modalEl = document.getElementById('ambiguityModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) {
        modal.hide();
    }

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

// --- Listener for Process Logs ---
const processLogContainer = document.getElementById('processLogContainer');
const processLogOutput = document.getElementById('processLogOutput');
window.electronAPI.onProcessLog((message) => {
    if (processLogContainer && processLogOutput) {
        processLogContainer.style.display = 'block'; // Show container
        processLogOutput.value += message + '\n'; // Append message
        processLogOutput.scrollTop = processLogOutput.scrollHeight; // Scroll to bottom
    }
});
// --- End Process Log Listener ---

// --- Listener for Errors from Main Process ---
const errorLogContainer = document.getElementById('errorLogContainer');
const errorLogOutput = document.getElementById('errorLogOutput');
function logErrorToUI(message) {
    if (errorLogContainer && errorLogOutput) {
        errorLogContainer.style.display = 'block'; // Show container
        errorLogOutput.value += message + '\n'; // Append error message
        errorLogOutput.scrollTop = errorLogOutput.scrollHeight; // Scroll to bottom
    }
}
window.electronAPI.onLogError(logErrorToUI);
// --- End Error Listener ---

// --- End Ambiguity Resolution Logic ---

// Validate directory inputs before starting operations
function validateDirectoryInputs() {
    let isValid = true;
    const mainDirInput = document.getElementById('mainDirectoryPath');
    const outputDirInput = document.getElementById('outputDirectoryPath');
    
    // Check main directory
    if (!mainDirInput.value.trim()) {
        mainDirInput.classList.add('is-invalid');
        isValid = false;
    } else {
        mainDirInput.classList.remove('is-invalid');
    }
    
    // Check output directory
    if (!outputDirInput.value.trim()) {
        outputDirInput.classList.add('is-invalid');
        isValid = false;
    } else {
        outputDirInput.classList.remove('is-invalid');
    }
    
    return isValid;
}

// Add event listeners to input fields to clear validation errors on change
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");

    // --- Directory Selection Buttons ---
    const selectMainDirBtn = document.getElementById('select-main-dir-button');
    if (selectMainDirBtn) {
        selectMainDirBtn.addEventListener('click', () => selectDirectory('mainDirectory'));
    }

    const selectOutputDirBtn = document.getElementById('select-output-dir-button');
    if (selectOutputDirBtn) {
        selectOutputDirBtn.addEventListener('click', () => selectDirectory('outputDirectory'));
    }

    // --- Processing Buttons ---
    const clearOutputBtn = document.getElementById('clearOutputBtn');
    if (clearOutputBtn) {
        clearOutputBtn.addEventListener('click', async () => {
            const outputDir = document.getElementById('outputDirectoryPath').value;
            if (!outputDir) {
                updateStatus('error', 'Output directory not set. Please select one.');
                return;
            }
            // Optional: Add a confirmation dialog here
            updateStatus('processing', 'Clearing output folder...');
            try {
                const result = await window.electronAPI.clearOutputFolder(outputDir);
                if (result.success) {
                    updateStatus('success', result.message);
                } else {
                    updateStatus('error', `Failed to clear: ${result.message}`);
                }
            } catch (error) {
                updateStatus('error', `Error clearing output: ${error.message}`);
            }
        });
    }

    const startTransformationBtn = document.getElementById('startTransformationBtn');
    if (startTransformationBtn) {
        startTransformationBtn.addEventListener('click', async () => {
            if (!validateDirectoryInputs()) {
                updateStatus('error', 'Please set both input and output directories.');
                return;
            }
            const mainDir = document.getElementById('mainDirectoryPath').value;
            const outputDir = document.getElementById('outputDirectoryPath').value;
            const dpi = parseInt(document.getElementById('dpi').value, 10) || 300; // Use config or default
            const folderPattern = document.getElementById('foldername-pattern').value; // Get folder pattern
            const isMoodleMode = folderPattern?.startsWith('FULLNAMEWITHSPACES');

            // --- Pre-check for Collisions --- 
            updateStatus('processing', 'Checking for potential name collisions...');
            try {
                // Determine if CSVs should be checked (only relevant in Moodle mode)
                const checkCSVs = isMoodleMode;
                console.log(`Pre-checking collisions for ${mainDir} with pattern "${folderPattern}", checking CSVs: ${checkCSVs}`);
                const collisionResult = await window.electronAPI.precheckCollisions(mainDir, folderPattern, checkCSVs);
                console.log("Pre-check result:", collisionResult);

                // Check for collisions OR mapping errors if CSVs were used
                if (collisionResult && (collisionResult.collisionDetected || (checkCSVs && collisionResult.mappingErrorDetected) || (checkCSVs && collisionResult.partialCsvCoverage && collisionResult.studentsAffected?.length > 0))) {
                    updateStatus('warning', 'Name collisions or mapping issues detected. Please resolve.');
                    // Store info for potential retry
                    lastInputDirectory = mainDir;
                    lastFolderPattern = folderPattern;
                    openMoodleCollisionModal(
                        collisionResult.collidingNames, 
                        collisionResult.usedCSVs, 
                        collisionResult.csvMappingsCount,
                        collisionResult.partialCsvCoverage,
                        collisionResult.missingCsvPages,
                        collisionResult.studentsAffected,
                        collisionResult.mappingErrors
                    );
                    return; // Stop before starting the main transformation
                }
                // --- End Pre-check --- 

                // If pre-check passes, proceed with transformation
                updateStatus('processing', 'Starting file conversion...');
                const result = await window.electronAPI.startTransformation(mainDir, outputDir, dpi);
                if (result && result.status === 'ambiguity_detected') {
                    updateStatus('info', result.message); 
                } else {
                     const successMessage = typeof result === 'string' ? result : 'Files converted successfully!';
                    updateStatus('success', successMessage);
                }
            } catch (error) {
                // Catch errors from pre-check OR transformation
                console.error("Error during pre-check or transformation:", error);
                // Handle FinalCollisionError specifically if it still occurs (should be caught by pre-check now)
                if (error.message?.includes('FinalCollisionError')) {
                     updateStatus('error', `Collision Error: ${error.message.replace('FinalCollisionError: ', '')}`);
                     // Potentially open the modal here too as a fallback, though pre-check should catch it
                     // For now, just show error status.
                } else {
                    updateStatus('error', `Error during conversion: ${error.message}`);
                }
            }
        });
    }

    const startMergingBtn = document.getElementById('startMergingBtn');
    if (startMergingBtn) {
        startMergingBtn.addEventListener('click', async () => {
            if (!validateDirectoryInputs()) {
                 updateStatus('error', 'Please set both input and output directories.');
                return;
            }
            const mainDir = document.getElementById('mainDirectoryPath').value; // Although not directly used, good for context
            const outputDir = document.getElementById('outputDirectoryPath').value;
            updateStatus('processing', 'Merging PDFs...');
            try {
                const result = await window.electronAPI.startMerging(mainDir, outputDir);
                updateStatus('success', result);
            } catch (error) {
                updateStatus('error', `Error merging PDFs: ${error.message}`);
            }
        });
    }

    const createBookletsBtn = document.getElementById('createBookletsBtn');
    if (createBookletsBtn) {
        createBookletsBtn.addEventListener('click', async () => {
            const outputDir = document.getElementById('outputDirectoryPath').value;
            if (!outputDir) {
                 updateStatus('error', 'Output directory not set.');
                return;
            }
            updateStatus('processing', 'Creating booklets...');
            try {
                const result = await window.electronAPI.createBooklets(outputDir);
                updateStatus('success', result);
            } catch (error) {
                updateStatus('error', `Error creating booklets: ${error.message}`);
            }
        });
    }

    // Settings Modal Button
    const settingsButton = document.getElementById('settingsButton');
    if (settingsButton) {
        settingsButton.addEventListener('click', openModal);
    } else {
        console.warn('Settings button not found');
    }

    // Pattern preset radio buttons
    document.querySelectorAll('input[name="pattern-preset"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const patternInput = document.getElementById('foldername-pattern');
            if (e.target.value !== 'custom') {
                patternInput.value = e.target.value;
                config.foldernamePattern = e.target.value;
                // Consider saving config here or on modal close
                saveConfig(); 
            }
            // If switching to custom, don't change input, just let user type
        });
    });
    // Also update pattern input if custom is selected and text is entered
    const patternInput = document.getElementById('foldername-pattern');
    if(patternInput) {
        patternInput.addEventListener('input', () => {
            document.getElementById('pattern-custom').checked = true;
            config.foldernamePattern = patternInput.value;
            saveConfig();
        });
    }

    // Cover template edit button
    const editCoverBtn = document.getElementById('editCoverTemplateBtn');
    if (editCoverBtn) {
        editCoverBtn.addEventListener('click', () => {
            const modalEl = document.getElementById('coverTemplateModal');
            const textarea = document.getElementById('coverTemplateContentInput');
            textarea.value = config.coverTemplateContent || DEFAULT_COVER_TEMPLATE;
            
            
            // Create and show the modal using Bootstrap
            const modal = new bootstrap.Modal(modalEl);

            // Handle focus management on hide
            modalEl.addEventListener('hide.bs.modal', { once: true }, () => {
                // Move focus back to the button when the modal is hidden
                setTimeout(() => editCoverBtn.focus(), 0);
            });
            
            modal.show();
            setTimeout(logBackdrop, 100);
        });
    } else {
        console.warn('Edit cover template button not found');
    }

    // --- Copy Log Button Listener ---
    const copyProcessLogBtn = document.getElementById('copyProcessLogBtn');
    if (copyProcessLogBtn) {
        copyProcessLogBtn.addEventListener('click', () => {
            const logOutput = document.getElementById('processLogOutput');
            if (logOutput && navigator.clipboard) {
                navigator.clipboard.writeText(logOutput.value)
                    .then(() => {
                        // Optional: Brief visual feedback
                        const originalIcon = copyProcessLogBtn.innerHTML;
                        copyProcessLogBtn.innerHTML = '<i class="bi bi-clipboard-check-fill text-success"></i>';
                        setTimeout(() => { copyProcessLogBtn.innerHTML = originalIcon; }, 1500);
                    })
                    .catch(err => {
                        console.error('Failed to copy process log:', err);
                        // Optional: Show error feedback
                    });
            } else {
                console.error('Could not find log output or clipboard API.');
            }
        });
    }

    // Initialize components or listeners that depend on the full DOM
    // For example, if ambiguity modal buttons needed setup here:
    // ambiguityPrevBtn.onclick = ... etc.
    // Make sure any functions called here (like openModal, saveConfig) are defined globally or passed correctly.

    // --- Import/Export Config Button Listeners ---
    const importBtn = document.getElementById('importConfigBtn');
    const exportBtn = document.getElementById('exportConfigBtn');

    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            console.log('Export Config button clicked.');
            try {
                // Ensure current UI settings are captured before exporting
                saveConfig(); // This saves the config to the config variable
                const result = await window.electronAPI.handleExportConfig(config);
                if (result.success) {
                    updateStatus('success', `Config exported to ${result.filePath}`);
                } else if (!result.cancelled) {
                    updateStatus('error', `Failed to export config: ${result.error}`);
                }
            } catch (error) {
                console.error('Error during config export:', error);
                updateStatus('error', `Error exporting config: ${error.message}`);
            }
        });
    } else {
        console.warn('Export Config button not found');
    }

    if (importBtn) {
        importBtn.addEventListener('click', async () => {
            console.log('Import Config button clicked.');
            try {
                const result = await window.electronAPI.handleImportConfig();
                if (result.success && result.config) {
                    updateStatus('success', `Config imported from ${result.filePath}`);
                    // Update the global config object
                    config = result.config; 
                    
                    // Manually update UI elements based on the new config
                    // This mirrors the logic in onLoadConfig
                    if (config.mainDirectory) document.getElementById('mainDirectoryPath').value = config.mainDirectory;
                    if (config.outputDirectory) document.getElementById('outputDirectoryPath').value = config.outputDirectory;
                    if (config.dpi) document.getElementById('dpi').value = config.dpi;
                    if (config.foldernamePattern) {
                        document.getElementById('foldername-pattern').value = config.foldernamePattern;
                        // Update radio buttons for pattern
                        const iliasPatternVal = document.getElementById('pattern-ilias')?.value;
                        const moodlePatternVal = document.getElementById('pattern-moodle')?.value;
                        if (iliasPatternVal && config.foldernamePattern === iliasPatternVal) {
                             document.getElementById('pattern-ilias').checked = true;
                        } else if (moodlePatternVal && config.foldernamePattern === moodlePatternVal) {
                             document.getElementById('pattern-moodle').checked = true;
                        } else {
                             const customRadio = document.getElementById('pattern-custom');
                             if (customRadio) customRadio.checked = true;
                        }
                    }
                    const coverTemplateTextarea = document.getElementById('coverTemplateContentInput');
                    if (coverTemplateTextarea) {
                        coverTemplateTextarea.value = config.coverTemplateContent || DEFAULT_COVER_TEMPLATE;
                    }
                    if (config.minFileSizeKB !== undefined) document.getElementById('minFileSizeKB').value = config.minFileSizeKB;
                    if (config.maxFileSizeMB !== undefined) document.getElementById('maxFileSizeMB').value = config.maxFileSizeMB;

                    // Optionally, save the newly imported config back to the default location immediately
                    // saveConfig(); // Decide if this is desired behavior

                } else if (!result.cancelled) {
                    updateStatus('error', `Failed to import config: ${result.error}`);
                }
            } catch (error) {
                console.error('Error during config import:', error);
                updateStatus('error', `Error importing config: ${error.message}`);
            }
        });
    } else {
        console.warn('Import Config button not found');
    }
});

// Global click listener for closing modals and saving config
window.addEventListener('click', (event) => {
    // Close on outside click (generic for all modals)
    const activeModal = document.querySelector('.modal[style*="display: block"]'); // Find visible modal
    if (activeModal && event.target === activeModal) {
        if (activeModal.id === 'coverTemplateModal') {
            const bsModal = bootstrap.Modal.getInstance(activeModal);
            if (bsModal) {
                bsModal.hide();
                window.saveConfig();
            }
        } else {
            activeModal.style.display = 'none';
        }
    }
    
    // Save config on outside click for specific modals
    const settingsModal = document.getElementById('settingsModal');
    const coverModal = document.getElementById('coverTemplateModal');
    
    if(settingsModal && event.target === settingsModal) {
        console.log('[DEBUG] Settings Modal: Click outside detected, triggering saveConfig.');
        window.saveConfig();
    }
});





