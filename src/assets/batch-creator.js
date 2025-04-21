/**
 * MBZ Batch Creator Component
 * Manages the batch creator view and integrates with the vertical calendar
 */

class MbzBatchCreator {
  /**
   * Initialize the batch creator
   * @param {HTMLElement} container - The container for the batch creator view
   * @param {Object} options - Configuration options
   */
  constructor(container, options = {}) {
    this.container = container;
    if (!this.container) {
      throw new Error('MBZ Batch Creator container element not found.');
    }
    
    this.options = Object.assign({
      // Default options
    }, options);
    
    // Internal state
    this.mbzPath = null;
    this.selectedDates = [];
    this.elements = {}; // To store references to DOM elements
    this.calendar = null;
    
    this.init();
  }
  
  /**
   * Initialize the component
   */
  init() {
    this.buildUI();
    this.findElements();
    this.setupCollapse();
    this.initCalendar();
    this.attachEventListeners();
    this.updateGenerateButtonState();
  }
  
  /**
   * Builds the UI structure by fetching content from mbz_creator.html via IPC
   */
  async buildUI() {
    try {
      // Fetch the HTML content via IPC from the main process
      const htmlContent = await window.electronAPI.loadMbzCreatorHtml();
      if (!htmlContent) {
        throw new Error('Received empty content for mbz_creator.html');
      }
      this.container.innerHTML = htmlContent;
      console.log('MBZ Creator UI loaded via IPC');
    } catch (error) {
      console.error('Error building MBZ Creator UI via IPC:', error);
      this.container.innerHTML = `<p class="text-danger">Error loading MBZ Creator UI: ${error.message}. Please check console.</p>`;
    }
    
    // Style injection is no longer needed here
  }
  
  /**
   * Find and store references to important DOM elements
   */
  findElements() {
    this.elements = {
      // Base elements
      selectMbzBtn: this.container.querySelector('#select-mbz-btn'),
      selectedFileLabel: this.container.querySelector('#selected-file-label'),
      templateToggleBtn: this.container.querySelector('#templateToggleBtn'),
      templateStatusText: this.container.querySelector('#templateStatusText'),
      customMbzSelector: this.container.querySelector('#customMbzSelector'),
      deadlineTime: this.container.querySelector('#deadlineTime'),
      gracePeriod: this.container.querySelector('#gracePeriod'),
      namePrefixInput: this.container.querySelector('#name-prefix-input'),
      sectionTitleInput: this.container.querySelector('#mbzSectionTitle'),
      targetStartDateInput: this.container.querySelector('#mbzTargetStartDate'),
      calendarContainer: this.container.querySelector('#vertical-calendar-container'),
      previewSection: this.container.querySelector('#selected-dates-preview-section'),
      previewTbody: this.container.querySelector('#dates-tbody'),
      generateBtn: this.container.querySelector('#generate-btn'),
      statusMessage: this.container.querySelector('#status-message'),
      // Removed mbzViewSwitchButton as it's no longer part of this template
      
      // Info sections
      templateInfo: this.container.querySelector('#templateInfo'),
      courseDetailsInfo: this.container.querySelector('#courseDetailsInfo'),
      deadlineInfo: this.container.querySelector('#deadlineInfo'),
      calendarInstructionsInfo: this.container.querySelector('#calendarInstructionsInfo'),
      previewInfo: this.container.querySelector('#previewInfo'),
      generateInfo: this.container.querySelector('#generateInfo'),
      
      // Collapse sections
      calendarInfoCollapse: this.container.querySelector('#calendarInfo'),
      previewTableCollapse: this.container.querySelector('#previewTable'),
      
      // Card headers
      calendarInfoHeader: this.container.querySelector('.card-header[href="#calendarInfo"]'),
      previewTableHeader: this.container.querySelector('.card-header[href="#previewTable"]'),
    };
    
    if (!this.elements.calendarContainer) {
      console.error('Calendar container not found.');
    }
  }
  
  /**
   * Set up collapse functionality for Bootstrap-style collapsible elements
   */
  setupCollapse() {
    // Handle info toggle buttons (i buttons)
    this.container.querySelectorAll('[data-bs-toggle="collapse"]').forEach(toggle => {
      const targetSelector = toggle.getAttribute('data-bs-target');
      if (!targetSelector) return;
      
      const targetElement = this.container.querySelector(targetSelector);
      if (!targetElement) return;
      
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        
        // Toggle the collapse state
        const isVisible = targetElement.classList.contains('show');
        if (isVisible) {
          targetElement.classList.remove('show');
        } else {
          targetElement.classList.add('show');
        }
      });
    });
  }
  
  /**
   * Initialize the vertical calendar
   */
  initCalendar() {
    if (!this.elements.calendarContainer) return;
    
    // Create a new vertical calendar
    this.calendar = new VerticalCalendar(this.elements.calendarContainer, {
      numMonths: 4,
      startDate: new Date(), // Start with the current month
      weekStartsOn: 1, // Monday
      enablePastDates: false,
      scrollable: true,
    });

    // Listen for calendar navigation events to refresh the controller
    const prevBtn = this.elements.calendarContainer.querySelector('.prev-month-btn');
    const nextBtn = this.elements.calendarContainer.querySelector('.next-month-btn');
    
    if (prevBtn) {
      const originalClickHandler = prevBtn.onclick;
      prevBtn.onclick = (e) => {
        if (originalClickHandler) originalClickHandler(e);
        // Refresh the controller after navigation
        setTimeout(() => {
          if (window.calendarController) window.calendarController.reapplyHighlights();
          if (this.controller) this.controller.refresh();
        }, 100);
      };
    }
    
    if (nextBtn) {
      const originalClickHandler = nextBtn.onclick;
      nextBtn.onclick = (e) => {
        if (originalClickHandler) originalClickHandler(e);
        // Refresh the controller after navigation
        setTimeout(() => {
          if (window.calendarController) window.calendarController.reapplyHighlights();
          if (this.controller) this.controller.refresh();
        }, 100);
      };
    }

    // Listen for when the calendar has been rendered
    this.elements.calendarContainer.addEventListener('calendarRendered', () => {
      // Refresh the controller when calendar is re-rendered
      if (this.controller) this.controller.refresh();
    });
  }
  
  /**
   * Attach event listeners to interactive elements
   */
  attachEventListeners() {
    // File selection
    this.elements.selectMbzBtn?.addEventListener('click', () => this.selectMbzFile());
    
    // Generate button
    this.elements.generateBtn?.addEventListener('click', () => this.generateBatchAssignments());
    
    // Removed listener for mbzViewSwitchButton
    
    // Template toggle button
    this.elements.templateToggleBtn?.addEventListener('click', () => {
      const isUsingDefault = this.elements.templateToggleBtn.textContent === 'Use Custom MBZ';
      
      if (isUsingDefault) {
        // Switch to custom MBZ
        this.elements.templateToggleBtn.textContent = 'Use Default Template';
        this.elements.templateStatusText.textContent = 'Using Custom MBZ File';
        this.elements.customMbzSelector.style.display = 'block';
        this.mbzPath = null;
        this.elements.selectedFileLabel.textContent = 'No file selected';
        this.updateGenerateButtonState();
      } else {
        // Switch back to default
        this.elements.templateToggleBtn.textContent = 'Use Custom MBZ';
        this.elements.templateStatusText.textContent = 'Using Default Backup Template (Moodle 4.5)';
        this.elements.customMbzSelector.style.display = 'none';
        this.mbzPath = null;
        this.updateGenerateButtonState();
      }

      // Ensure initial state matches button text
      if (this.elements.templateToggleBtn.textContent === 'Use Custom MBZ') {
          this.elements.templateStatusText.textContent = 'Using Default Template';
          this.elements.customMbzSelector.style.display = 'none';
      } else {
          this.elements.templateStatusText.textContent = 'Using Custom MBZ File';
          this.elements.customMbzSelector.style.display = 'block';
      }
    });
    
    // Handle info toggle buttons
    this.container.querySelectorAll('.info-toggle').forEach(toggle => {
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
      });
    });
    
    // Handle collapse sections with card headers
    this.container.querySelectorAll('.card-header[data-bs-toggle="collapse"]').forEach(header => {
      const targetId = header.getAttribute('href')?.substring(1);
      if (!targetId) return;
      
      const collapseElement = document.getElementById(targetId);
      const chevronIcon = header.querySelector('.bi-chevron-down, .bi-chevron-up');
      
      header.addEventListener('click', () => {
        // Toggle the collapse state
        const isExpanded = collapseElement.classList.contains('show');
        
        if (isExpanded) {
          collapseElement.classList.remove('show');
          if (chevronIcon) {
            chevronIcon.classList.remove('bi-chevron-up');
            chevronIcon.classList.add('bi-chevron-down');
          }
        } else {
          collapseElement.classList.add('show');
          if (chevronIcon) {
            chevronIcon.classList.remove('bi-chevron-down');
            chevronIcon.classList.add('bi-chevron-up');
          }
        }
      });
    });
    
    // Format the deadline time input to validate
    this.elements.deadlineTime?.addEventListener('blur', () => {
      // Simple format validation
      const timeValue = this.elements.deadlineTime.value;
      const timePattern = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/;
      
      if (!timePattern.test(timeValue)) {
        // Revert to default if invalid
        this.elements.deadlineTime.value = '17:00:00';
      } else if (timeValue.split(':').length === 2) {
        // Add seconds if missing
        this.elements.deadlineTime.value = `${timeValue}:00`;
      }
    });
  }
  
  /**
   * Handle the selection of the template MBZ file
   */
  async selectMbzFile() {
    try {
      const result = await window.electronAPI.showOpenDialog({
        title: 'Select Template MBZ File',
        properties: ['openFile'],
        filters: [{ name: 'Moodle Backup Files', extensions: ['mbz', 'gz'] }]
      });
      
      if (!result.canceled && result.filePaths.length > 0) {
        this.mbzPath = result.filePaths[0];
        const basename = await window.electronAPI.pathBasename(this.mbzPath);
        this.elements.selectedFileLabel.textContent = basename;
        this.elements.selectedFileLabel.title = this.mbzPath; // Show full path on hover
        this.updateGenerateButtonState();
        this.setStatus('Template file selected. Now select dates in the calendar.', 'info');
      } else {
        this.mbzPath = null;
        this.elements.selectedFileLabel.textContent = 'No file selected';
        this.updateGenerateButtonState();
      }
    } catch (error) {
      console.error('Error selecting MBZ file:', error);
      this.setStatus(`Error selecting file: ${error.message}`, 'error');
      this.mbzPath = null;
    }
  }
  
  /**
   * Update the generate button state based on selections
   */
  updateGenerateButtonState() {
    if (this.elements.generateBtn) {
      const isUsingCustom = this.elements.templateToggleBtn?.textContent === 'Use Default Template';
      
      if (isUsingCustom) {
        // When using custom MBZ, require a file selection
        this.elements.generateBtn.disabled = !this.mbzPath || this.selectedDates.length === 0;
      } else {
        // When using default template, only require dates
        this.elements.generateBtn.disabled = this.selectedDates.length === 0;
      }
    }
  }
  
  /**
   * Set status message with styling
   */
  setStatus(message, type = 'info') {
    if (this.elements.statusMessage) {
      this.elements.statusMessage.textContent = message;
      this.elements.statusMessage.className = `status-message ${type}`;
    }
  }
  
  /**
   * Generate batch assignments
   */
  async generateBatchAssignments() {
    // Check if we're using custom MBZ and validate path
    const isUsingCustom = this.elements.templateToggleBtn.textContent === 'Use Default Template';
    
    if (isUsingCustom && !this.mbzPath) {
      this.setStatus('Please select custom MBZ file before generating.', 'error');
      return;
    }
    
    // If we're using default and have no dates, show error
    if (!isUsingCustom && this.selectedDates.length === 0) {
      this.setStatus('Please select dates in the calendar before generating.', 'error');
      return;
    }
    
    try {
      this.setStatus('Generating batch assignments... Please wait.', 'info');
      this.elements.generateBtn.disabled = true;
      
      // Get values from UI elements
      const namePrefix = this.elements.namePrefixInput?.value || 'Assignment';
      
      // Parse the deadline time
      const deadlineTimeStr = this.elements.deadlineTime?.value || '17:00:00';
      const timeParts = deadlineTimeStr.split(':');
      const timeHour = parseInt(timeParts[0] || '17', 10);
      const timeMinute = parseInt(timeParts[1] || '0', 10);
      
      // Get grace period
      const gracePeriod = parseInt(this.elements.gracePeriod?.value || '5', 10);
      
      const sectionTitle = this.elements.sectionTitleInput?.value.trim() || null;
      const targetStartDate = this.elements.targetStartDateInput?.value || null; // Expects YYYY-MM-DD
      
      // Validation
      if (!sectionTitle) {
        this.setStatus('Please provide the Moodle Section Title.', 'error');
        this.elements.sectionTitleInput?.focus();
        this.elements.generateBtn.disabled = false;
        return;
      }
      
      if (!targetStartDate) {
        this.setStatus('Please provide the Moodle Course Start Date.', 'error');
        this.elements.targetStartDateInput?.focus();
        this.elements.generateBtn.disabled = false;
        return;
      }
      
      // Basic date format check
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetStartDate)) {
        this.setStatus('Moodle Course Start Date must be in YYYY-MM-DD format.', 'error');
        this.elements.targetStartDateInput?.focus();
        this.elements.generateBtn.disabled = false;
        return;
      }
      
      // Generate the suggested filename with current date and time
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const suggestedFilename = `booklet-pages-${year}-${month}-${day}-${hours}${minutes}${seconds}.mbz`;
      
      // Show save dialog to let user choose where to save the file
      const saveResult = await window.electronAPI.showSaveDialog({
        title: 'Save MBZ File',
        defaultPath: suggestedFilename,
        filters: [
          { name: 'Moodle Backup Files', extensions: ['mbz'] }
        ]
      });
      
      if (saveResult.canceled) {
        this.setStatus('File save cancelled.', 'info');
        this.elements.generateBtn.disabled = false;
        return;
      }
      
      const outputPath = saveResult.filePath;
      if (!outputPath) {
        this.setStatus('No save location selected.', 'error');
        this.elements.generateBtn.disabled = false;
        return;
      }
      
      // Determine source MBZ file path
      let mbzFilePath;
      if (isUsingCustom) {
        // Using custom MBZ file
        mbzFilePath = this.mbzPath;
      } else {
        // Using default MBZ template
        try {
          // Get the default template path from the main process via IPC
          const templateMbzPath = await window.electronAPI.getDefaultMbzTemplatePath();
          if (!templateMbzPath) {
            throw new Error('Main process did not return a default template path.');
          }
          
          mbzFilePath = templateMbzPath; // Use the path returned by the main process
          await window.electronAPI.fsExists(mbzFilePath); // Check if it exists
          this.setStatus('Using default MBZ template.', 'info');
        } catch (err) {
          console.error('Default MBZ template check failed:', err);
          this.setStatus(`Error: Default MBZ template not found or inaccessible at expected path. ${err.message}`, 'error');
          this.elements.generateBtn.disabled = false;
          this.elements.generateBtn.textContent = 'Generate Batch Assignments';
          return;
        }
      }
      
      const options = {
        mbzFilePath: mbzFilePath,
        useDefaultTemplate: !isUsingCustom,
        selectedDates: this.selectedDates.map(date => {
          // Format date as YYYY-MM-DD
          const year = date.getUTCFullYear();
          const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
          const day = date.getUTCDate().toString().padStart(2, '0');
          return `${year}-${month}-${day}`;
        }).sort(),
        timeHour: timeHour,
        timeMinute: timeMinute,
        gracePeriod: gracePeriod,
        namePrefix: namePrefix,
        outputDir: outputPath ? await window.electronAPI.pathDirname(outputPath) : '',
        outputFilename: outputPath ? await window.electronAPI.pathBasename(outputPath) : suggestedFilename,
        sectionTitle: sectionTitle,
        targetStartDate: targetStartDate,
        gracePeriodMinutes: parseInt(this.elements.gracePeriod?.value || '0', 10)
      };
      
      console.log("Sending options to main process:", options);
      
      // Call the backend function
      const result = await window.electronAPI.createBatchAssignments(options);
      
      if (result.success) {
        this.setStatus(`Successfully created ${this.selectedDates.length} assignments. Saved to: ${result.outputPath}`, 'success');
      } else {
        this.setStatus(`Error: ${result.message}`, 'error');
      }
    } catch (error) {
      console.error('Error generating batch assignments:', error);
      this.setStatus(`Error: ${error.message}`, 'error');
    } finally {
      this.elements.generateBtn.disabled = false;
    }
  }
  
  /**
   * Set the calendar controller instance
   * @param {VerticalCalendarController} controller - The controller instance
   */
  setController(controller) {
    this.controller = controller;
  }
  
  /**
   * Method called by the calendar controller to update selected dates
   * @param {Date[]} newDates - Array of selected Date objects
   */
  updateSelectedDates(newDates) {
    this.selectedDates = newDates;
    console.log('MbzBatchCreator: Selected dates updated by controller:', this.selectedDates.map(d => d.toISOString().split('T')[0]));
    this.updateGenerateButtonState(); // Update button state whenever dates change
  }
  
  /**
   * Static factory method to create the batch creator
   */
  static initialize(container) {
    return new MbzBatchCreator(container);
  }
}

// Expose the class to the global scope
window.MbzBatchCreator = MbzBatchCreator; 