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
          
          <!-- Main configuration form -->
          <div class="config-form">
            <!-- 1. Template Selection -->
            <div class="config-section">
              <h5 class="section-title">1. Select Moodle Backup Template</h5>
              <div class="form-section template-selection">
                <div class="form-check mb-2">
                  <input class="form-check-input" type="radio" name="templateChoice" id="useDefault" checked>
                  <label class="form-check-label" for="useDefault">
                    Use Default (Moodle 4.5)
                  </label>
                </div>
                <div class="form-check mb-3 d-flex justify-content-between align-items-center">
                  <div>
                    <input class="form-check-input" type="radio" name="templateChoice" id="useCustom">
                    <label class="form-check-label" for="useCustom">
                      Use Custom File
                    </label>
                  </div>
                  <button id="select-mbz-btn" class="btn btn-outline-secondary">Choose File</button>
                </div>
                <div class="selected-file-info">
                  <span id="selected-file-label" class="fst-italic text-muted">No file selected</span>
                </div>
              </div>
            </div>
            
            <!-- 2. Course Details -->
            <div class="config-section">
              <h5 class="section-title">2. Course Details</h5>
              <div class="form-section">
                <div class="mb-3">
                  <label for="mbzSectionTitle" class="form-label">Moodle Section Title</label>
                  <input type="text" class="form-control" id="mbzSectionTitle" 
                     placeholder="Exam Booklet Pages">
                </div>
                
                <div class="mb-3">
                  <label for="name-prefix-input" class="form-label">Assignment Name Prefix</label>
                  <input type="text" id="name-prefix-input" class="form-control" 
                     placeholder="Page" value="Page">
                </div>
                
                <div class="mb-3">
                  <label for="mbzTargetStartDate" class="form-label">Course Start Date as configured in Moodle</label>
                  <input type="date" class="form-control" id="mbzTargetStartDate">
                </div>
              </div>
            </div>
            
            <!-- 3. Deadline Settings -->
            <div class="config-section">
              <h5 class="section-title">3. Deadline Settings</h5>
              <div class="form-section">
                <div class="mb-3">
                  <label for="time-settings" class="form-label">Deadline Time for All Pages</label>
                  <div class="d-flex time-selector" id="time-settings">
                    <select id="hour-select" class="form-select me-1">
                      ${Array.from({length: 24}, (_, i) => `<option value="${i}" ${i === 17 ? 'selected' : ''}>${String(i).padStart(2, '0')}</option>`).join('')}
                    </select>
                    <span class="mx-1 align-self-center">:</span>
                    <select id="minute-select" class="form-select ms-1">
                      ${Array.from({length: 12}, (_, i) => `<option value="${i*5}" ${i*5 === 0 ? 'selected' : ''}>${String(i*5).padStart(2, '0')}</option>`).join('')}
                    </select>
                  </div>
                </div>
                
                <div class="mb-3">
                  <label for="grace-period" class="form-label">Additional Grace Period until Cutoff (minutes)</label>
                  <input type="number" class="form-control grace-period-input" id="grace-period" value="5" min="0" max="1440">
                </div>
              </div>
            </div>
            
            <!-- Preview Assignments (Collapsible) -->
            <div class="config-section">
              <button class="preview-toggle-btn collapsed" type="button" data-bs-toggle="collapse" 
                     data-bs-target="#previewSection" aria-expanded="false" aria-controls="previewSection">
                <span class="preview-title">Preview Assignment Table</span>
                <span class="toggle-icon">▼</span>
              </button>
              
              <div class="collapse" id="previewSection">
                <div id="selected-dates-preview-section" class="preview-content">
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
                  <div class="text-muted mt-2 small">Review the generated assignment names and deadlines. 'Available From' is based on the previous assignment's due date.</div>
                </div>
              </div>
            </div>
            
            <!-- Generate Button -->
            <div class="generate-section">
              <button id="generate-btn" class="btn btn-primary btn-lg w-100" disabled>Generate Batch MBZ File</button>
              <div id="status-message" class="status-message mx-auto mt-3"></div>
            </div>
          </div>
        </div>
        
        <!-- Right Column: Vertical Calendar -->
        <div class="mbz-creator-right">
          <div id="vertical-calendar-container" class="vertical-calendar-container"></div>
        </div>
      </div>
    `;
    
    // Add custom CSS for the updated UI
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      .mbz-creator-view {
        display: flex;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      
      .mbz-creator-left {
        width: 60%;
        padding: 1rem;
        overflow-y: auto;
        max-height: 100vh;
      }
      
      .mbz-creator-right {
        width: 40%;
        border-left: 1px solid #e9ecef;
      }
      
      .config-form {
        padding: 0.5rem 0;
      }
      
      .config-section {
        border: 1px solid #dee2e6;
        border-radius: 6px;
        padding: 1.25rem;
        margin-bottom: 1.5rem;
        background-color: #fff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      }
      
      .section-title {
        margin-top: 0;
        margin-bottom: 1.25rem;
        font-weight: 600;
        color: #212529;
      }
      
      .form-section {
        padding: 0.25rem 0;
      }
      
      .selected-file-info {
        font-size: 0.875rem;
        padding: 0.25rem 0;
      }
      
      .time-selector {
        max-width: 150px;
      }
      
      .grace-period-input {
        max-width: 120px;
      }
      
      .preview-toggle-btn {
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        padding: 0.75rem 1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: #212529;
        font-weight: 600;
        cursor: pointer;
      }
      
      .preview-toggle-btn:hover {
        background-color: #f8f9fa;
      }
      
      .preview-toggle-btn .toggle-icon {
        transition: transform 0.2s ease;
      }
      
      .preview-toggle-btn.collapsed .toggle-icon {
        transform: rotate(-90deg);
      }
      
      .preview-content {
        padding: 1rem 0.5rem;
      }
      
      .generate-section {
        padding: 1rem 0;
        margin-top: 1rem;
      }
      
      .status-message {
        margin-top: 1rem;
        padding: 0.5rem;
        border-radius: 4px;
        text-align: center;
      }
      
      .status-message.info {
        background-color: #cff4fc;
        color: #055160;
      }
      
      .status-message.success {
        background-color: #d1e7dd;
        color: #0a3622;
      }
      
      .status-message.error {
        background-color: #f8d7da;
        color: #842029;
      }
    `;
    document.head.appendChild(styleEl);
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
      previewToggleBtn: this.container.querySelector('.preview-toggle-btn'),
      previewCollapseEl: this.container.querySelector('#previewSection')
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
  }
  
  /**
   * Attach event listeners to interactive elements
   */
  attachEventListeners() {
    this.elements.selectMbzBtn?.addEventListener('click', () => this.selectMbzFile());
    this.elements.generateBtn?.addEventListener('click', () => this.generateBatchAssignments());
    
    // Add toggle functionality for the preview section
    this.elements.previewToggleBtn?.addEventListener('click', () => {
      const isCollapsed = this.elements.previewToggleBtn.classList.contains('collapsed');
      this.elements.previewToggleBtn.classList.toggle('collapsed', !isCollapsed);
      
      // If we have Bootstrap available, this will work automatically through data attributes
      // If not, we handle the collapse manually
      if (!window.bootstrap) {
        if (isCollapsed) {
          this.elements.previewCollapseEl.style.display = 'block';
        } else {
          this.elements.previewCollapseEl.style.display = 'none';
        }
      }
    });
    
    // Template choice radio buttons
    const useDefaultRadio = this.container.querySelector('#useDefault');
    const useCustomRadio = this.container.querySelector('#useCustom');
    
    if (useDefaultRadio && useCustomRadio) {
      useDefaultRadio.addEventListener('change', () => {
        if (useDefaultRadio.checked) {
          // Use default template logic
          this.mbzPath = 'default'; // Special value to indicate using default
          this.elements.selectedFileLabel.textContent = 'Using default Moodle 4.5 template';
          this.updateGenerateButtonState();
        }
      });
      
      useCustomRadio.addEventListener('change', () => {
        if (useCustomRadio.checked) {
          // Prompt for custom file
          this.mbzPath = null;
          this.elements.selectedFileLabel.textContent = 'No file selected';
          this.updateGenerateButtonState();
          // Optionally trigger file selection
          if (confirm('Would you like to select a custom template file now?')) {
            this.selectMbzFile();
          }
        }
      });
    }
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
   * Static factory method to create the batch creator
   */
  static initialize(container) {
    return new MbzBatchCreator(container);
  }
}

// Expose the class to the global scope
window.MbzBatchCreator = MbzBatchCreator; 