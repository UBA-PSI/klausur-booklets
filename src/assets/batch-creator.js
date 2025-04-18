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
    this.initCalendar();
    this.attachEventListeners();
    this.updateGenerateButtonState();
  }
  
  /**
   * Builds the UI structure
   */
  buildUI() {
    // Create the two-column layout
    this.container.innerHTML = `
      <div class="mbz-creator-view">
        <!-- Left Column: Configuration -->
        <div class="mbz-creator-left">
          <!-- App Header - Only spans the left column -->
          <div class="app-header">
            <div class="app-title-container">
              <h1 class="app-title">Booklet Page Tool</h1>
              <span id="app-mode" class="app-mode">Moodle Batch Assignment Creation Mode</span>
            </div>
            <button id="app-mode-switch" class="app-switcher">Switch Mode</button>
          </div>
          
          <h2 class="mt-4 mb-3">Batch Assignment Creator</h2>
          
          <!-- 1. Template Selection -->
          <div class="section">
            <h5 class="mb-3">1. Select Template MBZ</h5>
            <div class="d-flex align-items-center">
              <button id="select-mbz-btn" class="btn btn-secondary">Select MBZ File</button>
              <span id="selected-file-label" class="ms-3 fst-italic">No file selected</span>
            </div>
            <div class="form-text mt-2">Select the '.mbz' template file provided with the script.</div>
          </div>
          
          <!-- 2. Configuration -->
          <div class="section mt-4">
            <h5 class="mb-3">2. Configure Assignment Details</h5>
            
            <div class="mb-3">
              <label for="name-prefix-input" class="form-label">Assignment Name Prefix:</label>
              <input type="text" id="name-prefix-input" class="form-control" 
                 placeholder="e.g., Weekly Assignment" value="Booklet Page">
              <div class="form-text">Prefix used for naming assignments (e.g., "Booklet Page 1", "Booklet Page 2").</div>
            </div>
            
            <div class="mb-3">
              <label for="mbzSectionTitle" class="form-label">Moodle Section Title:</label>
              <input type="text" class="form-control" id="mbzSectionTitle" 
                 placeholder="e.g., Exam Booklet Pages">
              <div class="form-text">Exact title of the section in your Moodle course where assignments will be added.</div>
            </div>
            
            <div class="mb-3">
              <label for="mbzTargetStartDate" class="form-label">Moodle Course Start Date:</label>
              <input type="date" class="form-control" id="mbzTargetStartDate">
              <div class="form-text">Must match the start date of the target Moodle course. Set course start time to 00:00.</div>
            </div>
          </div>
          
          <!-- 3. Time Configuration -->
          <div class="section mt-4">
            <h5 class="mb-3">3. Set Default Deadline Time</h5>
            <div class="d-flex align-items-center">
              <label for="hour-select" class="form-label me-2">Time:</label>
              <select id="hour-select" class="form-select me-1" style="width: auto;">
                ${Array.from({length: 24}, (_, i) => `<option value="${i}" ${i === 17 ? 'selected' : ''}>${String(i).padStart(2, '0')}</option>`).join('')}
              </select>
              <span class="mx-1">:</span>
              <select id="minute-select" class="form-select ms-1" style="width: auto;">
                ${Array.from({length: 12}, (_, i) => `<option value="${i*5}" ${i*5 === 0 ? 'selected' : ''}>${String(i*5).padStart(2, '0')}</option>`).join('')}
              </select>
            </div>
            <div class="form-text">Default time for all assignment deadlines (e.g., 17:00 for 5 PM).</div>
          </div>
          
          <!-- 5. Preview -->
          <div id="selected-dates-preview-section" class="section mt-4 hidden">
            <h5 class="mb-3">5. Preview Selected Dates</h5>
            <div class="table-responsive">
              <table id="dates-table" class="table table-striped table-hover">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Assignment Name</th>
                    <th>Due Date & Time</th>
                    <th>Available From</th>
                  </tr>
                </thead>
                <tbody id="dates-tbody"></tbody>
              </table>
            </div>
            <div class="form-text mt-2">Review the generated assignment names and deadlines. 'Available From' is based on the previous assignment's due date.</div>
          </div>
          
          <!-- Generate Button -->
          <div class="mt-4 mb-4 text-center">
            <button id="generate-btn" class="btn btn-primary btn-lg px-4" disabled>Generate Batch MBZ File</button>
            <div id="status-message" class="status-message mx-auto mt-3"></div>
          </div>
        </div>
        
        <!-- Right Column: Vertical Calendar -->
        <div class="mbz-creator-right">
          <div id="vertical-calendar-container" class="vertical-calendar-container"></div>
        </div>
      </div>
    `;
  }
  
  /**
   * Find and store references to important DOM elements
   */
  findElements() {
    this.elements = {
      selectMbzBtn: this.container.querySelector('#select-mbz-btn'),
      selectedFileLabel: this.container.querySelector('#selected-file-label'),
      namePrefixInput: this.container.querySelector('#name-prefix-input'),
      sectionTitleInput: this.container.querySelector('#mbzSectionTitle'),
      targetStartDateInput: this.container.querySelector('#mbzTargetStartDate'),
      hourSelect: this.container.querySelector('#hour-select'),
      minuteSelect: this.container.querySelector('#minute-select'),
      calendarContainer: this.container.querySelector('#vertical-calendar-container'),
      previewSection: this.container.querySelector('#selected-dates-preview-section'),
      previewTbody: this.container.querySelector('#dates-tbody'),
      generateBtn: this.container.querySelector('#generate-btn'),
      statusMessage: this.container.querySelector('#status-message'),
    };
    
    if (!this.elements.calendarContainer) {
      console.error('Calendar container not found.');
    }
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
    this.elements.selectMbzBtn?.addEventListener('click', () => this.selectMbzFile());
    this.elements.generateBtn?.addEventListener('click', () => this.generateBatchAssignments());
    
    // Note: Input change listeners that triggered the old updatePreview are removed.
    // calendar-fix.js will now handle updating the preview based on these inputs.
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
      this.elements.generateBtn.disabled = !this.mbzPath || this.selectedDates.length === 0;
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
    if (!this.mbzPath || this.selectedDates.length === 0) {
      this.setStatus('Please select MBZ file and dates before generating.', 'error');
      return;
    }
    
    try {
      this.setStatus('Generating batch assignments... Please wait.', 'info');
      this.elements.generateBtn.disabled = true;
      
      // Get values from UI elements
      const namePrefix = this.elements.namePrefixInput?.value || 'Assignment';
      const timeHour = parseInt(this.elements.hourSelect?.value || '0', 10);
      const timeMinute = parseInt(this.elements.minuteSelect?.value || '0', 10);
      const sectionTitle = this.elements.sectionTitleInput?.value.trim() || null;
      const targetStartDate = this.elements.targetStartDateInput?.value || null; // Expects YYYY-MM-DD
      
      // Validation
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
      
      // Prepare options for backend
      const outputDir = await window.electronAPI.pathDirname(this.mbzPath);
      
      const options = {
        mbzFilePath: this.mbzPath,
        selectedDates: this.selectedDates.map(date => {
          // Format date as YYYY-MM-DD
          const year = date.getUTCFullYear();
          const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
          const day = date.getUTCDate().toString().padStart(2, '0');
          return `${year}-${month}-${day}`;
        }).sort(),
        timeHour: timeHour,
        timeMinute: timeMinute,
        namePrefix: namePrefix,
        outputDir: outputDir,
        sectionTitle: sectionTitle,
        targetStartDate: targetStartDate,
      };
      
      console.log("Sending options to main process:", options);
      
      // Call the backend function
      const result = await window.electronAPI.createBatchAssignments(options);
      
      if (result.success) {
        this.setStatus(`Success: ${result.message}`, 'success');
        await window.electronAPI.showMessageBox({
          type: 'info',
          title: 'Batch Creation Complete',
          message: `Successfully created ${this.selectedDates.length} assignments.`,
          detail: `Output saved to: ${result.outputPath}`,
          buttons: ['OK']
        });
      } else {
        this.setStatus(`Error: ${result.message}`, 'error');
        await window.electronAPI.showMessageBox({
          type: 'error',
          title: 'Batch Creation Failed',
          message: result.message,
          buttons: ['OK']
        });
      }
    } catch (error) {
      console.error('Error generating batch assignments:', error);
      this.setStatus(`Error: ${error.message}`, 'error');
      await window.electronAPI.showMessageBox({
        type: 'error',
        title: 'Batch Creation Failed',
        message: `An error occurred: ${error.message}`,
        buttons: ['OK']
      });
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
   * Static factory method to create the batch creator
   */
  static initialize(container) {
    return new MbzBatchCreator(container);
  }
}

// Expose the class to the global scope
window.MbzBatchCreator = MbzBatchCreator; 