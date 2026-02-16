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

/**
 * Sets the processing state — disables/enables action buttons and shows/hides abort button.
 * @param {boolean} active - True while processing is running
 * @param {boolean} [showAbort=true] - Whether to show the abort button (false for step 1)
 */
function setProcessingState(active, showAbort = true) {
    const buttonIds = ['clearOutputBtn', 'startTransformationBtn', 'startMergingBtn', 'createBookletsBtn'];
    buttonIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = active;
    });

    const abortBtn = document.getElementById('abortBtn');
    if (abortBtn) {
        abortBtn.style.display = (active && showAbort) ? 'inline-block' : 'none';
        abortBtn.disabled = false;
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
    // Load PDF output settings
    if (config.marginMinMm !== undefined) {
        document.getElementById('marginMinMm').value = config.marginMinMm;
    }
    if (config.padToMultipleOf4) {
        document.getElementById('padToMultipleOf4').checked = true;
    }

    // Load PDF renderer selection
    if (config.pdfRenderer) {
        if (config.pdfRenderer === 'ghostscript') {
            document.getElementById('renderer-ghostscript').checked = true;
        } else if (config.pdfRenderer === 'pdfium') {
            document.getElementById('renderer-pdfium').checked = true;
        }
    } else {
        // Default to PDFium (built-in, works without additional software)
        document.getElementById('renderer-pdfium').checked = true;
        config.pdfRenderer = 'pdfium';
    }

    // Load Ghostscript path type — migrate 'bundled' to 'system' (bundled no longer exists)
    if (config.ghostscriptPathType === 'bundled' || !config.ghostscriptPathType) {
        config.ghostscriptPathType = 'system';
        saveConfig();
    }
    if (config.ghostscriptPathType === 'custom') {
        document.getElementById('gs-path-custom').checked = true;
    } else {
        document.getElementById('gs-path-system').checked = true;
    }
    
    // Load Ghostscript path (only for custom)
    if (config.ghostscriptPath) {
        document.getElementById('ghostscriptPath').value = config.ghostscriptPath;
    }
    
    // Update UI visibility based on current selections
    updateRendererUIVisibility();
    validateGhostscriptInSettings();

    // Show Ghostscript recommendation banner when PDFium is active
    showGsRecommendationBanner();
});


/**
 * Shows or hides the Ghostscript recommendation banner based on the current renderer.
 * When PDFium is selected, a dismissable banner is shown at the top of the main view.
 */
function showGsRecommendationBanner() {
    const banner = document.getElementById('gsRecommendationBanner');
    if (!banner) return;

    const isUsingGhostscript = config.pdfRenderer === 'ghostscript';
    banner.classList.toggle('d-none', isUsingGhostscript);
}

/**
 * Updates the visibility of renderer-specific UI sections based on current selections
 */
function updateRendererUIVisibility() {
    const pdfRenderer = document.querySelector('input[name="pdfRenderer"]:checked')?.value;
    const ghostscriptPathType = document.querySelector('input[name="ghostscriptPathType"]:checked')?.value;

    // Show/hide Ghostscript configuration based on renderer selection
    const ghostscriptConfig = document.getElementById('ghostscriptConfig');
    if (ghostscriptConfig) {
        ghostscriptConfig.style.display = pdfRenderer === 'ghostscript' ? 'block' : 'none';
    }

    // Show/hide custom path input based on Ghostscript path type
    const customPathDiv = document.getElementById('customGhostscriptPath');
    if (customPathDiv) {
        customPathDiv.style.display = (pdfRenderer === 'ghostscript' && ghostscriptPathType === 'custom') ? 'block' : 'none';
    }

    // Show/hide PDFium recommendation when PDFium is selected
    let pdfiumWarning = document.getElementById('pdfiumRecommendation');
    if (pdfRenderer === 'pdfium') {
        if (!pdfiumWarning) {
            pdfiumWarning = document.createElement('div');
            pdfiumWarning.id = 'pdfiumRecommendation';
            pdfiumWarning.className = 'alert alert-info py-2 mt-3';
            const icon = document.createElement('i');
            icon.className = 'bi bi-info-circle me-1';
            pdfiumWarning.appendChild(icon);
            pdfiumWarning.appendChild(document.createTextNode('For best results with all PDF types, install Ghostscript and select it as renderer.'));
            const rendererCard = document.querySelector('.card:has(#renderer-pdfium) .card-body');
            if (rendererCard) rendererCard.appendChild(pdfiumWarning);
        }
        pdfiumWarning.style.display = 'block';
    } else if (pdfiumWarning) {
        pdfiumWarning.style.display = 'none';
    }
}

/**
 * Validates the current Ghostscript configuration and shows status in Settings UI
 */
async function validateGhostscriptInSettings() {
    const pdfRenderer = document.querySelector('input[name="pdfRenderer"]:checked')?.value;
    if (pdfRenderer !== 'ghostscript') {
        // Hide status when Ghostscript is not selected
        const statusEl = document.getElementById('ghostscriptStatus');
        if (statusEl) statusEl.style.display = 'none';
        return;
    }

    const statusEl = document.getElementById('ghostscriptStatus');
    const statusTextEl = document.getElementById('ghostscriptStatusText');
    if (!statusEl || !statusTextEl) return;

    // Show checking state
    statusEl.className = 'alert alert-info py-2';
    statusEl.style.display = 'block';
    statusTextEl.textContent = 'Checking Ghostscript...';

    try {
        const result = await window.electronAPI.validateGhostscript();
        // Clear existing content
        statusTextEl.textContent = '';

        if (result.available) {
            statusEl.className = 'alert alert-success py-2';
            const icon = document.createElement('i');
            icon.className = 'bi bi-check-circle me-1';
            statusTextEl.appendChild(icon);
            statusTextEl.appendChild(document.createTextNode('Ghostscript found '));
            const versionCode = document.createElement('code');
            versionCode.textContent = `v${result.version}`;
            statusTextEl.appendChild(versionCode);
            statusTextEl.appendChild(document.createTextNode(' at '));
            const pathCode = document.createElement('code');
            pathCode.textContent = result.path;
            statusTextEl.appendChild(pathCode);
        } else {
            statusEl.className = 'alert alert-danger py-2';
            const icon = document.createElement('i');
            icon.className = 'bi bi-exclamation-triangle me-1';
            statusTextEl.appendChild(icon);
            statusTextEl.appendChild(document.createTextNode('Ghostscript not found at '));
            const pathCode = document.createElement('code');
            pathCode.textContent = result.path;
            statusTextEl.appendChild(pathCode);
        }
    } catch (error) {
        statusEl.className = 'alert alert-danger py-2';
        statusTextEl.textContent = `Validation error: ${error.message}`;
    }
}

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
    
    // Save PDF output settings
    const marginValue = parseFloat(document.getElementById('marginMinMm').value);
    config.marginMinMm = isNaN(marginValue) ? 3.5 : marginValue;
    config.padToMultipleOf4 = document.getElementById('padToMultipleOf4').checked;

    // Save PDF renderer selection
    config.pdfRenderer = document.querySelector('input[name="pdfRenderer"]:checked').value;
    
    // Save Ghostscript path type
    config.ghostscriptPathType = document.querySelector('input[name="ghostscriptPathType"]:checked').value;
    
    // Save Ghostscript path (only relevant for custom type)
    config.ghostscriptPath = document.getElementById('ghostscriptPath').value;

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
    setProcessingState(false);
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
    } finally {
        setProcessingState(false);
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

// --- Helper to log to process log ---
function logProcessMessage(message) {
    if (processLogContainer && processLogOutput) {
        processLogContainer.style.display = 'block'; // Show container
        // Format timestamp consistently
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const timestamp = `${hours}:${minutes}:${seconds}`;
        processLogOutput.value += `[${timestamp}] ${message}\n`; // Append message with timestamp
        processLogOutput.scrollTop = processLogOutput.scrollHeight; // Scroll to bottom
    }
}
// --- End Helper ---

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
            setProcessingState(true, false); // no abort button for clear
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
            } finally {
                setProcessingState(false);
            }
        });
    }

    const startTransformationBtn = document.getElementById('startTransformationBtn');
    if (startTransformationBtn) {
        startTransformationBtn.addEventListener('click', async () => {
            // Clear previous log containers when starting new conversion
            const processLogContainer = document.getElementById('processLogContainer');
            const errorLogContainer = document.getElementById('errorLogContainer');
            const processLogOutput = document.getElementById('processLogOutput');
            const errorLogOutput = document.getElementById('errorLogOutput');
            
            if (processLogContainer) {
                processLogContainer.style.display = 'none';
            }
            if (errorLogContainer) {
                errorLogContainer.style.display = 'none';
            }
            if (processLogOutput) {
                processLogOutput.value = '';
            }
            if (errorLogOutput) {
                errorLogOutput.value = '';
            }
            
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
            setProcessingState(true);
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
                    setProcessingState(false); // re-enable buttons before returning
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
                } else {
                    updateStatus('error', `Error during conversion: ${error.message}`);
                }
            } finally {
                setProcessingState(false);
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
            const mainDir = document.getElementById('mainDirectoryPath').value;
            const outputDir = document.getElementById('outputDirectoryPath').value;
            setProcessingState(true);
            updateStatus('processing', 'Merging PDFs...');
            logProcessMessage('UI: Clicked Merge PDFs button. Invoking merge...');
            try {
                const result = await window.electronAPI.startMerging(mainDir, outputDir);
                updateStatus('success', result);
            } catch (error) {
                updateStatus('error', `Error merging PDFs: ${error.message}`);
            } finally {
                setProcessingState(false);
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
            setProcessingState(true);
            updateStatus('processing', 'Creating booklets...');
            try {
                const result = await window.electronAPI.createBooklets(outputDir);
                updateStatus('success', result);
            } catch (error) {
                updateStatus('error', `Error creating booklets: ${error.message}`);
            } finally {
                setProcessingState(false);
            }
        });
    }

    // Abort Button
    const abortBtn = document.getElementById('abortBtn');
    if (abortBtn) {
        abortBtn.addEventListener('click', async () => {
            abortBtn.disabled = true;
            updateStatus('processing', 'Aborting...');
            try {
                await window.electronAPI.abortProcessing();
            } catch (error) {
                console.error('Error sending abort signal:', error);
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

    // PDF Renderer radio buttons
    document.querySelectorAll('input[name="pdfRenderer"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            config.pdfRenderer = e.target.value;
            updateRendererUIVisibility();
            validateGhostscriptInSettings();
            showGsRecommendationBanner();
            saveConfig();
        });
    });

    // Ghostscript path type radio buttons
    document.querySelectorAll('input[name="ghostscriptPathType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            config.ghostscriptPathType = e.target.value;
            updateRendererUIVisibility();
            validateGhostscriptInSettings();
            saveConfig();
        });
    });

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
                    
                    // Update PDF renderer selection
                    if (config.pdfRenderer === 'pdfium') {
                        document.getElementById('renderer-pdfium').checked = true;
                    } else {
                        document.getElementById('renderer-ghostscript').checked = true;
                    }
                    
                    // Update Ghostscript path type — migrate 'bundled' to 'system'
                    if (config.ghostscriptPathType === 'bundled') {
                        config.ghostscriptPathType = 'system';
                    }
                    if (config.ghostscriptPathType === 'custom') {
                        document.getElementById('gs-path-custom').checked = true;
                    } else {
                        document.getElementById('gs-path-system').checked = true;
                    }
                    
                    // Update Ghostscript path if provided
                    if (config.ghostscriptPath) {
                        document.getElementById('ghostscriptPath').value = config.ghostscriptPath;
                    }
                    
                    // Update UI visibility based on imported config
                    updateRendererUIVisibility();

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

    // --- End Import/Export Config Button Listeners ---
    
    // --- Ghostscript Path Button Listeners ---
    const browseGhostscriptBtn = document.getElementById('browseGhostscriptPath');
    const clearGhostscriptBtn = document.getElementById('clearGhostscriptPath');
    const ghostscriptPathInput = document.getElementById('ghostscriptPath');
    
    if (browseGhostscriptBtn && ghostscriptPathInput) {
        browseGhostscriptBtn.addEventListener('click', async () => {
            console.log('Browse Ghostscript path button clicked.');
            try {
                const result = await window.electronAPI.selectGhostscriptExecutable();
                if (result.success) {
                    ghostscriptPathInput.value = result.path;
                    config.ghostscriptPath = result.path;
                    saveConfig();

                    // Validate the selected Ghostscript path
                    validateGhostscriptInSettings();

                    updateStatus('success', 'Ghostscript executable selected');
                }
            } catch (error) {
                console.error('Error selecting Ghostscript executable:', error);
                updateStatus('error', `Error selecting Ghostscript: ${error.message}`);
            }
        });
    }
    
    if (clearGhostscriptBtn && ghostscriptPathInput) {
        clearGhostscriptBtn.addEventListener('click', () => {
            console.log('Clear Ghostscript path button clicked.');
            ghostscriptPathInput.value = '';
            config.ghostscriptPath = '';
            saveConfig();

            // Re-validate with system/default Ghostscript
            validateGhostscriptInSettings();

            updateStatus('info', 'Ghostscript path cleared - using default');
        });
    }
    // --- End Ghostscript Path Button Listeners ---

    // --- Ghostscript Recommendation Banner Links ---
    const gsLearnMoreLink = document.getElementById('gsRecommendationLearnMore');
    if (gsLearnMoreLink) {
        gsLearnMoreLink.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                const homepage = await window.electronAPI.getAppHomepage();
                const readmeUrl = (homepage || 'https://github.com/UBA-PSI/klausur-booklets/') + '#why-ghostscript';
                window.electronAPI.openExternal(readmeUrl);
            } catch (error) {
                console.error('Failed to open Ghostscript info link:', error);
            }
        });
    }
    const gsOpenSettingsLink = document.getElementById('gsRecommendationOpenSettings');
    if (gsOpenSettingsLink) {
        gsOpenSettingsLink.addEventListener('click', (e) => {
            e.preventDefault();
            openModal();
        });
    }
    // --- End Ghostscript Recommendation Banner Links ---

    // --- Initialize version display ---
    const appVersionDisplay = document.getElementById('appVersionDisplay');
    if (appVersionDisplay) {
        window.electronAPI.getAppVersion()
            .then(version => {
                appVersionDisplay.textContent = `v${version}`;
                appVersionDisplay.title = `Version ${version}`;
            })
            .catch(err => {
                console.error('Failed to load app version:', err);
                appVersionDisplay.textContent = '';
            });
    }

    // --- Handle open settings for Ghostscript ---
    window.electronAPI.onOpenSettingsGhostscript(() => {
        console.log('Received request to open settings with Ghostscript focus');
        openModal(); // Open the settings modal
    });
    
    // --- More Info Button Listener ---
    const moreInfoBtn = document.getElementById('moreInfoBtn');
    if (moreInfoBtn) {
        moreInfoBtn.addEventListener('click', async () => {
            const modalEl = document.getElementById('moreInfoModal');
            const versionSpan = document.getElementById('appVersionSpan');
            const repoLink = document.getElementById('repoLink');
            const changelogLink = document.getElementById('changelogLink');

            if (modalEl && versionSpan) {
                try {
                    // Fetch version and homepage when modal is opened
                    versionSpan.textContent = 'Fetching...'; // Show loading state
                    const version = await window.electronAPI.getAppVersion();
                    const homepage = await window.electronAPI.getAppHomepage();
                    versionSpan.textContent = version || 'N/A';
                    
                    // Update the repo link with the homepage from package.json
                    if (repoLink && homepage) {
                        repoLink.href = homepage;
                        repoLink.textContent = homepage + ' ';
                        repoLink.innerHTML += '<i class="bi bi-box-arrow-up-right ms-1"></i>';
                    }
                    
                    // Update the changelog link
                    if (changelogLink && homepage) {
                        changelogLink.href = homepage + '/blob/main/CHANGELOG.md';
                        changelogLink.innerHTML = 'View Changelog <i class="bi bi-box-arrow-up-right ms-1"></i>';
                    }

                    const modal = new bootstrap.Modal(modalEl);
                    modal.show();
                } catch (error) {
                    console.error('Error fetching app info:', error);
                    versionSpan.textContent = 'Error';
                    // Show modal anyway, but indicate error
                    const modal = new bootstrap.Modal(modalEl);
                    modal.show();
                }
            } else {
                console.error('More Info modal elements not found.');
            }
        });
    } else {
        console.warn('More Info button not found');
    }
    // --- End More Info Button Listener ---
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





