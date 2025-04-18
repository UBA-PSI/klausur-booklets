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
   * Builds the UI structure
   */
  buildUI() {
    // Create the two-column layout with polished design
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
            <button id="app-mode-switch" class="app-switcher" onclick="window.appSwitcher?.toggleView()">Switch Mode</button>
          </div>
          
          <!-- 1. Template Selection -->
          <div class="card shadow-sm mb-3">
            <div class="card-body p-4">
              <h5 class="card-title fw-bold mb-3">
                1. Select Moodle Backup Template
                <button class="btn btn-sm text-primary p-0 ms-2 info-toggle" type="button" data-bs-toggle="collapse" data-bs-target="#templateInfo" aria-expanded="false">
                  <i class="bi bi-info-circle"></i>
                </button>
              </h5>
              
              <div class="collapse mb-3" id="templateInfo">
                <div class="card card-body bg-light py-2 text-muted small">
                  The backup template defines the structure and settings for your assignments. 
                  You can use the default template for Moodle 4.5 or provide your own custom MBZ file.
                </div>
              </div>
              
              <div class="d-flex align-items-center justify-content-between">
                <div class="template-status">
                  <span class="fw-medium" id="templateStatusText">Using Default Backup Template (Moodle 4.5)</span>
                </div>
                <button class="btn btn-outline-primary btn-sm" id="templateToggleBtn">Use Custom MBZ</button>
              </div>
              
              <!-- Custom MBZ file selector (initially hidden) -->
              <div id="customMbzSelector" class="mt-3" style="display: none;">
                <div class="d-flex align-items-center">
                  <button id="select-mbz-btn" class="btn btn-secondary">Select MBZ File</button>
                  <span id="selected-file-label" class="ms-3 fst-italic">No file selected</span>
                </div>
                <div class="form-text mt-2">Select the '.mbz' template file provided with the script.</div>
              </div>
            </div>
          </div>
          
          <!-- 2. Configuration -->
          <div class="card shadow-sm mb-3">
            <div class="card-body p-4">
              <h5 class="card-title fw-bold mb-3">
                2. Course Details
                <button class="btn btn-sm text-primary p-0 ms-2 info-toggle" type="button" data-bs-toggle="collapse" data-bs-target="#courseDetailsInfo" aria-expanded="false">
                  <i class="bi bi-info-circle"></i>
                </button>
              </h5>
              
              <div class="collapse mb-3" id="courseDetailsInfo">
                <div class="card card-body bg-light py-2 text-muted small">
                  The section title must match exactly what's in your course. This is where the assignments will be inserted.
                  The start date is critical for proper date calculations. You must configure the Moodle course to start at the time entered here.
                  Otherwise, Moodle may change the deadlines during import.
                  Important: Configure the course in Moodle to start at midnight (00:00 o'clock).
                </div>
              </div>
              
              <div class="ps-0 small text-muted">
                The following must match your course configuration in Moodle (see docs).
                <span class="d-block mt-1">Fields marked with <span class="text-danger">*</span> are required.</span>
              </div>
              
              <div class="mt-3 mb-3 row">
                <label for="mbzSectionTitle" class="col-sm-5 col-form-label">Moodle Section Title <span class="text-danger">*</span></label>
                <div class="col-sm-7">
                  <input type="text" class="form-control" id="mbzSectionTitle" placeholder="e.g., Exam Booklet Pages" required>
                </div>
              </div>
              
              <div class="mb-3 row">
                <label for="mbzTargetStartDate" class="col-sm-5 col-form-label">Course Start Date <span class="text-danger">*</span></label>
                <div class="col-sm-7">
                  <input type="date" class="form-control" id="mbzTargetStartDate" required>
                </div>
              </div>
              
              <div class="ps-0 mb-3 small text-muted">
                How shall the activities be named? A number will be appended automatically.
              </div>
              
              <div class="mb-3 row">
                <label for="name-prefix-input" class="col-sm-5 col-form-label">Assignment Name Prefix</label>
                <div class="col-sm-7">
                  <input type="text" class="form-control" id="name-prefix-input" placeholder="e.g., Page" value="Booklet Page">
                </div>
              </div>
            </div>
          </div>
          
          <!-- 3. Deadline Settings -->
          <div class="card shadow-sm mb-3">
            <div class="card-body p-4">
              <h5 class="card-title fw-bold mb-3">
                3. Deadline Settings
                <button class="btn btn-sm text-primary p-0 ms-2 info-toggle" type="button" data-bs-toggle="collapse" data-bs-target="#deadlineInfo" aria-expanded="false">
                  <i class="bi bi-info-circle"></i>
                </button>
              </h5>
              
              <div class="collapse mb-3" id="deadlineInfo">
                <div class="card card-body bg-light py-2 text-muted small">
                  Set the time of day when all assignments are due. The grace period extends the cutoff time 
                  after the deadline. Students can still submit during the grace period but their submissions 
                  will be marked as late.
                </div>
              </div>
              
              <div class="row mb-3 align-items-center">
                <label for="deadlineTime" class="col-sm-5 col-form-label">Deadline Time for All Pages</label>
                <div class="col-sm-7 d-flex align-items-center">
                  <input type="text" class="form-control" id="deadlineTime" placeholder="e.g., 23:59:59" value="17:00:00"> 
                  <span class="ms-2 me-1">+</span>
                  <input type="number" class="form-control ms-1" id="gracePeriod" value="5" min="0" style="width: 60px;">
                  <span class="ms-1">min</span>
                </div>
              </div>
              <div class="ps-0 mb-2 small text-muted">
                The grace period is used to set the final cutoff time, i.e., how long Moodle will accept submissions after the displayed deadline.
              </div>
            </div>
          </div>
          
          <!-- 4. Calendar Instructions -->
          <div class="card shadow-sm mb-3">
            <div class="card-header bg-light" data-bs-toggle="collapse" href="#calendarInfo" role="button" aria-expanded="true" aria-controls="calendarInfo">
              <div class="d-flex justify-content-between align-items-center">
                <h5 class="card-title mb-0 fw-bold">
                  4. Select Deadline Days from Calendar
                  <button class="btn btn-sm text-primary p-0 ms-2 info-toggle" type="button" data-bs-toggle="collapse" data-bs-target="#calendarInstructionsInfo" aria-expanded="false" onclick="event.stopPropagation();">
                    <i class="bi bi-info-circle"></i>
                  </button>
                </h5>
                <i class="bi bi-chevron-down"></i>
              </div>
            </div>
            <div class="collapse show" id="calendarInfo">
              <div class="card-body bg-light py-2 border-bottom">
                <div class="collapse" id="calendarInstructionsInfo">
                  <div class="card card-body bg-light py-2 text-muted small mb-2">
                    Click on dates in the calendar to select them as assignment deadlines. 
                    Hold Ctrl/Cmd to select multiple dates, or Shift to select a range of dates.
                  </div>
                </div>
                <p class="mb-1">
                  <span class="fw-medium">Instructions:</span>
                  <ul class="mb-0">
                    <li>Click on a date to select it</li>
                    <li>Hold <kbd>Ctrl</kbd> or <kbd>⌘</kbd> to select multiple dates</li>
                    <li>Hold <kbd>Shift</kbd> to select a range of dates</li>
                  </ul>
                </p>
              </div>
            </div>
          </div>
          
          <!-- 5. Preview -->
          <div id="selected-dates-preview-section" class="card shadow-sm mb-3 hidden">
            <div class="card-header bg-light" data-bs-toggle="collapse" href="#previewTable" role="button" aria-expanded="false" aria-controls="previewTable">
              <div class="d-flex justify-content-between align-items-center">
                <h5 class="card-title mb-0 fw-bold">
                  5. Preview Selected Dates
                  <button class="btn btn-sm text-primary p-0 ms-2 info-toggle" type="button" data-bs-toggle="collapse" data-bs-target="#previewInfo" aria-expanded="false" onclick="event.stopPropagation();">
                    <i class="bi bi-info-circle"></i>
                  </button>
                </h5>
                <i class="bi bi-chevron-down"></i>
              </div>
            </div>
            <div class="collapse" id="previewInfo">
              <div class="card card-body bg-light py-2 border-bottom text-muted small">
                This table shows how your assignments will appear in Moodle after import. 
                Each assignment's "Available From" date is automatically calculated based on 
                previous assignments.
              </div>
            </div>
            <div class="collapse show" id="previewTable">
              <div class="card-body p-0">
                <div class="table-responsive">
                  <table id="dates-table" class="table table-striped mb-0">
                    <thead class="table-light">
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
                <div class="px-3 py-2 bg-light border-top">
                  <small class="text-muted">
                    Review the generated assignment names and deadlines.
                    'Available From' is always based on the previous assignment's due date.
                    Changes to the dates can later be made in Moodle.
                  </small>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Generate Button -->
          <div class="card shadow-sm mb-3">
            <div class="card-body p-4">                        
              <div>
                <button id="generate-btn" class="btn btn-primary btn-lg" disabled>Generate MBZ File</button>
                <button class="btn btn-sm text-primary p-0 ms-2 info-toggle" type="button" data-bs-toggle="collapse" data-bs-target="#generateInfo" aria-expanded="false">
                  <i class="bi bi-info-circle"></i>
                </button>                        
                <div class="collapse mt-3 mb-3" id="generateInfo">
                  <div class="card card-body bg-light py-2 text-muted small">
                    Creates a Moodle backup (.mbz) file that you can import into your course. 
                    This file will contain all assignments with the dates and settings you've specified.
                  </div>
                </div>
                <div id="status-message" class="status-message mx-auto mt-3"></div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Right Column: Vertical Calendar -->
        <div class="mbz-creator-right">
          <div id="vertical-calendar-container" class="vertical-calendar-container"></div>
        </div>
      </div>
    `;
    
    // Add styles for the polished design
    const styleId = 'mbz-creator-styles';
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.textContent = `
        /* Card styling */
        .mbz-creator-view .card {
          border-radius: 8px;
          border: 1px solid rgba(0,0,0,0.1);
          margin-bottom: 15px;
        }
        
        .mbz-creator-view .card-title {
          color: #333;
          font-size: 1.1rem;
        }
        
        /* Improved form layout */
        .mbz-creator-view .col-form-label {
          font-size: 0.9rem;
          font-weight: 500;
          color: #555;
        }
        
        /* Toggle button styling */
        .mbz-creator-view .info-toggle {
          box-shadow: none !important;
          outline: none !important;
          line-height: 1;
          background: transparent !important;
          border: none !important;
        }
        
        .mbz-creator-view .info-toggle:focus,
        .mbz-creator-view .info-toggle:active {
          box-shadow: none !important;
        }
        
        /* Remove info icon background/border */
        .mbz-creator-view .info-toggle .bi-info-circle {
          color: #0d6efd;
        }
        
        /* Placeholder text styling */
        .mbz-creator-view ::placeholder {
          color: #adb5bd;
          opacity: 1;
        }
        
        /* Card header styling */
        .mbz-creator-view .card-header {
          cursor: pointer;
          transition: background-color 0.2s;
        }
        
        .mbz-creator-view .card-header:hover {
          background-color: #e9ecef;
        }
        
        /* Table styling */
        .mbz-creator-view .table th {
          font-weight: 600;
          font-size: 0.85rem;
        }
        
        .mbz-creator-view .table td {
          font-size: 0.9rem;
        }
        
        /* Generate button styling */
        .mbz-creator-view #generate-btn {
          background-color: #0066cc;
          border-color: #0066cc;
          font-weight: 500;
          border-radius: 6px;
        }
        
        .mbz-creator-view #generate-btn:hover {
          background-color: #0056b3;
          border-color: #0056b3;
        }
        
        /* Status message styling */
        .mbz-creator-view .status-message {
          padding: 8px;
          margin-top: 10px;
          border-radius: 4px;
          font-size: 0.9rem;
        }
        
        .mbz-creator-view .status-message.error {
          background-color: #f8d7da;
          color: #721c24;
        }
        
        .mbz-creator-view .status-message.success {
          background-color: #d4edda;
          color: #155724;
        }
        
        .mbz-creator-view .status-message.info {
          background-color: #d1ecf1;
          color: #0c5460;
        }
        
        /* Keyboard key styling */
        .mbz-creator-view kbd {
          padding: 0.1rem 0.4rem;
          font-size: 0.8rem;
          color: #fff;
          background-color: #212529;
          border-radius: 0.2rem;
          box-shadow: inset 0 -0.1rem 0 rgba(0,0,0,.25);
        }
        
        /* Column widths */
        .mbz-creator-left { 
          width: 60% !important; 
          padding-right: 15px;
        }
        .mbz-creator-right { 
          width: 40% !important; 
          padding-left: 15px;
        }
        
        /* Vertical calendar styles */
        .vertical-calendar-container {
          height: 100%;
          border: 1px solid rgba(0,0,0,0.1);
          border-radius: 8px;
          overflow: hidden;
          background-color: #fff;
        }
        
        /* Template status styling */
        .template-status {
          color: #495057;
        }
        
        /* Chevron rotation */
        .rotate-icon {
          transform: rotate(180deg);
        }
      `;
      document.head.appendChild(styleEl);
    }
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
        // Set default MBZ path (if you have one)
        this.mbzPath = 'default'; // This would be replaced with your actual default path
        this.updateGenerateButtonState();
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
        mbzFilePath = './moodle-4.5-2024100700.mbz'; // Default MBZ template
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
   * Static factory method to create the batch creator
   */
  static initialize(container) {
    return new MbzBatchCreator(container);
  }
}

// Expose the class to the global scope
window.MbzBatchCreator = MbzBatchCreator; 