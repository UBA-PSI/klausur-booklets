class MbzBatchCreator {
    constructor(mainView) {
        this.mainView = mainView;
        this.logger = new SimpleLogger('[MbzBatchCreator]');
        this.logger.log("Constructor called.");
        // Basic properties initialization
        this.elements = {}; 
        this.selectedDates = [];
        this.isInitialized = false;

        // Delay finding elements until init is called AFTER buildUI
        // this.findElements(); 
        // this.attachEventListeners(); // Also delay attaching listeners
    }

    /**
     * Finds and stores references to key DOM elements.
     */
    findElements() {
        this.logger.log('Finding elements...');
        const elements = {
            // Input Fields
            namePrefixInput: this.mainView.querySelector('#name-prefix-input'),
            deadlineTimeInput: this.mainView.querySelector('#deadlineTime'),
            gracePeriodInput: this.mainView.querySelector('#gracePeriod'),
            templateFileInput: this.mainView.querySelector('#template-file'),
            
            // Calendar & Preview
            calendarContainer: this.mainView.querySelector('#vertical-calendar-container'),
            datesTbody: this.mainView.querySelector('#dates-tbody'),
            selectedDatesPreviewSection: this.mainView.querySelector('#selected-dates-preview-section'),
            
            // Buttons & Actions
            generateButton: this.mainView.querySelector('#generate-mbz-button'),
            clearDatesButton: this.mainView.querySelector('#clear-dates-button'),
            chooseTemplateButton: this.mainView.querySelector('#choose-template-button'),
            
            // Display Areas
            templateFilePathDisplay: this.mainView.querySelector('#template-file-path'),
            loadingOverlay: this.mainView.querySelector('#loading-overlay'),
        };

        // Basic validation
        for (const key in elements) {
            if (!elements[key]) {
                this.logger.error(`Element not found: ${key}`);
            } else {
                this.logger.debug(`Element found: ${key}`);
            }
        }

        this.elements = elements;
    }

    /**
     * Attaches event listeners to the elements.
     */
    attachEventListeners() {
        this.logger.log('Attaching event listeners...');

        // Template Selection
        this.elements.chooseTemplateButton?.addEventListener('click', async () => {
            const result = await window.electronAPI.sendSync('dialog:openFile', {
                title: 'Choose MBZ Template File',
                buttonLabel: 'Select Template',
                properties: ['openFile'],
                filters: [{ name: 'MBZ Files', extensions: ['mbz'] }],
            });
            if (result && result.filePath) {
                this.logger.log(`Template selected: ${result.filePath}`);
                this.elements.templateFileInput.value = result.filePath;
                this.elements.templateFilePathDisplay.textContent = result.filePath;
                this.elements.templateFilePathDisplay.title = result.filePath; // Tooltip for long paths
            } else {
                this.logger.warn('Template selection cancelled or failed.');
            }
        });

        // Generate Button
        this.elements.generateButton?.addEventListener('click', () => this.handleGenerateClick());
        
        // Clear Dates Button
        this.elements.clearDatesButton?.addEventListener('click', () => this.clearSelectedDates());
        
        // Input validations or updates (e.g., deadline time format)
        this.elements.deadlineTimeInput?.addEventListener('blur', (e) => {
            const input = e.target;
            if (input.value && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(input.value)) {
                this.logger.warn('Invalid time format. Reverting to default.');
                showErrorModal('Invalid time format. Please use HH:MM (24-hour clock).');
                input.value = '17:00'; // Reset to default
            }
        });
        
        this.logger.log('Event listeners attached.');
    }
    
    /**
     * Updates the list of selected dates based on calendar interactions.
     * @param {Date[]} dates - An array of selected Date objects.
     */
    updateSelectedDates(dates) {
        this.selectedDates = dates.sort((a, b) => a.getTime() - b.getTime());
        this.logger.log(`Received ${dates.length} dates from calendar.`);
        this.validateInputsAndToggleButton(); // Re-validate when dates change
    }
    
    /**
     * Clears all selected dates and updates the calendar and preview.
     */
    clearSelectedDates() {
        this.logger.log('Clearing selected dates via Controller API.');
        // Use the globally exposed API method from VerticalCalendarController
        if (window.VerticalCalendarControllerAPI && typeof window.VerticalCalendarControllerAPI.clearSelection === 'function') {
             window.VerticalCalendarControllerAPI.clearSelection();
        } else {
            // Fallback/Warning if the controller API isn't ready (shouldn't normally happen)
            this.logger.warn('VerticalCalendarControllerAPI or clearSelection method not found. Attempting manual clear.');
            this.selectedDates = []; // Clear local array
            this.elements.calendarContainer?.querySelectorAll('.calendar-day.direct-selected')
                .forEach(el => {
                    el.classList.remove('direct-selected');
                    delete el.dataset.selectionIndex; // Also clear index data attribute
                });
            if(this.elements.datesTbody) this.elements.datesTbody.innerHTML = ''; // Clear preview table
            if(this.elements.selectedDatesPreviewSection) this.elements.selectedDatesPreviewSection.style.display = 'none';
            this.validateInputsAndToggleButton(); // Update button state after manual clear
        }
        // Note: validateInputsAndToggleButton is called implicitly by the controller's clearSelection->updateBatchCreatorDates
    }

    /**
     * Validates required inputs and enables/disables the generate button.
     */
    validateInputsAndToggleButton() {
        const isTemplateSelected = !!this.elements.templateFileInput?.value;
        const areDatesSelected = this.selectedDates.length > 0;
        const canGenerate = isTemplateSelected && areDatesSelected;
        
        if (this.elements.generateButton) {
            this.elements.generateButton.disabled = !canGenerate;
            this.logger.debug(`Generate button ${canGenerate ? 'enabled' : 'disabled'}. Template: ${isTemplateSelected}, Dates: ${areDatesSelected}`);
        }
    }

    /**
     * Handles the click event for the generate button.
     */
    handleGenerateClick() {
        this.logger.log('Generate button clicked.');
        if (this.elements.generateButton?.disabled) {
            this.logger.warn('Generate clicked but button is disabled.');
            return; // Should not happen if validation logic is correct
        }

        const templatePath = this.elements.templateFileInput?.value;
        const namePrefix = this.elements.namePrefixInput?.value || 'Assignment';
        const deadlineTime = this.elements.deadlineTimeInput?.value || '17:00';
        const gracePeriodDays = parseInt(this.elements.gracePeriodInput?.value || '7', 10);

        if (!templatePath || this.selectedDates.length === 0) {
            showErrorModal('Missing template file or selected dates.');
            this.logger.error('Validation failed before sending IPC message.');
            return;
        }
        
        this.showLoadingOverlay(true);

        const ipcPayload = {
            templatePath,
            dates: this.selectedDates.map(d => d.toISOString()), // Send ISO strings
            namePrefix,
            deadlineTime,
            gracePeriodDays,
        };
        
        this.logger.log('Sending mbz:createBatchAssignments IPC message.', ipcPayload);

        window.electronAPI.invoke('mbz:createBatchAssignments', ipcPayload)
            .then(result => {
                this.logger.log('mbz:createBatchAssignments IPC response received:', result);
                this.showLoadingOverlay(false);
                if (result.success) {
                    showSuccessModal('Batch assignments created successfully!', `Files saved to: ${result.outputDir}`);
                    this.logger.log('Batch creation successful.');
                    // Optionally clear dates after success
                    // this.clearSelectedDates(); 
                } else {
                    showErrorModal('Failed to create batch assignments.', result.error);
                    this.logger.error('Batch creation failed:', result.error);
                }
            })
            .catch(error => {
                this.logger.error('IPC call mbz:createBatchAssignments failed:', error);
                this.showLoadingOverlay(false);
                showErrorModal('An error occurred during batch creation.', error.message || error);
            });
    }

    /**
     * Shows or hides the loading overlay.
     * @param {boolean} show - True to show, false to hide.
     */
    showLoadingOverlay(show) {
        if (this.elements.loadingOverlay) {
            this.elements.loadingOverlay.style.display = show ? 'flex' : 'none';
            this.logger.log(`Loading overlay ${show ? 'shown' : 'hidden'}.`);
        } else {
            this.logger.warn('Loading overlay element not found.');
        }
    }

    /**
     * Builds the UI by loading HTML content.
     * @returns {Promise<void>}
     */
    async buildUI() {
        this.logger.log('Building UI...');
        try {
            const response = await fetch('./mbz-creator/mbz-creator.html');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const html = await response.text();
            this.mainView.innerHTML = html;
            this.logger.log('UI HTML loaded successfully.');
            
        } catch (error) {
            this.logger.error('Error loading MBZ Creator HTML:', error);
            this.mainView.innerHTML = '<p class="error-message">Error loading MBZ Creator interface. Please check console.</p>';
            showErrorModal('Failed to load UI component.', error.message);
        }
    }

    /**
     * Initializes the MBZ Batch Creator module.
     * @returns {Promise<void>}
     */
    async init() {
        if (this.isInitialized) {
            this.logger.warn('Already initialized.');
            return;
        }
        this.logger.log('Initializing MBZ Batch Creator...');
        await this.buildUI(); // Wait for UI to be loaded
        
        // Now find elements and attach listeners
        this.findElements();
        this.attachEventListeners();
        
        // Now initialize the calendar controller, passing this instance
        if (typeof VerticalCalendarController !== 'undefined' && typeof VerticalCalendarController.initialize === 'function') {
            try {
                this.logger.log('Initializing VerticalCalendarController...');
                // Pass the calendar container element and this MbzBatchCreator instance
                const calendarController = VerticalCalendarController.initialize(
                    this.elements.calendarContainer, 
                    this // Pass the instance
                );
                if (calendarController) {
                    this.logger.log('VerticalCalendarController initialized successfully.');
                } else {
                    this.logger.error('VerticalCalendarController.initialize returned null or failed.');
                }
            } catch (error) {
                this.logger.error('Error during VerticalCalendarController initialization:', error);
                showErrorModal('Failed to initialize the calendar component.', error.message);
            }
        } else {
            this.logger.error('VerticalCalendarController or its initialize method is not defined.');
            showErrorModal('Calendar component script not loaded correctly.');
        }

        this.validateInputsAndToggleButton(); // Initial validation check
        this.showLoadingOverlay(false); // Ensure overlay is hidden initially
        this.isInitialized = true;
        this.logger.log('MBZ Batch Creator initialized successfully.');
    }
} 