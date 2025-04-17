// Handles the frontend UI logic for the MBZ Batch Creator using flatpickr.
// Browser-compatible version

// Access flatpickr from global scope (loaded via script tag)
// Use the electronAPI bridge instead of require()

class MbzBatchCreatorUI {
  /**
   * Initializes the UI by finding elements and attaching event listeners.
   * @param {HTMLElement} containerElement - The DOM element to build the UI within.
   */
  constructor(containerElement) {
    this.container = containerElement;
    if (!this.container) {
      throw new Error('MBZ Batch Creator UI container element not found.');
    }

    this.mbzPath = null;
    this.selectedDates = [];

    this.elements = {}; // To store references to DOM elements

    this.init();
  }

  /**
   * Builds the HTML structure and finds key elements.
   */
  init() {
    this.buildUI();
    this.findElements();
    this.initFlatpickr();
    this.attachEventListeners();
    this.updatePreview(); // Initial state
    this.updateGenerateButtonState();
  }

  /**
   * Creates the necessary HTML elements within the container.
   */
  buildUI() {
    // Basic HTML structure - consider using template literals or a templating engine for complex UI
    this.container.innerHTML = `
      <div class="mbz-creator">
        <h2>Batch Assignment Creator</h2>

        <div class="section file-section">
          <h3>1. Select Template MBZ</h3>
          <div class="file-selector">
            <button id="select-mbz-btn" class="btn">Select MBZ File</button>
            <span id="selected-file-label">No file selected</span>
          </div>
          <!-- Optional: Display template info after selection -->
        </div>

        <div class="section prefix-section">
          <h3>2. Set Assignment Name Prefix</h3>
          <input type="text" id="name-prefix-input" class="input-field" placeholder="e.g., Weekly Assignment" value="Booklet Page">
        </div>


<div class="mb-3">
<label for="mbzSectionTitle" class="form-label">Section Title (Optional):</label>
<input type="text" class="form-control" id="mbzSectionTitle" placeholder="e.g., Weekly Assignments">
<div class="form-text">If provided, the title of the main course section will be updated in the MBZ files.</div>
</div>

<div class="mb-3">
<label for="mbzTargetStartDate" class="form-label">Target Start Date (Optional):</label>
<input type="date" class="form-control" id="mbzTargetStartDate">
 <div class="form-text">If provided, the course start date within the MBZ file will be updated.</div>
</div>

        <div class="section time-section">
          <h3>3. Set Default Time for All Deadlines</h3>
          <div class="time-picker">
            <label for="hour-select">Time:</label>
            <select id="hour-select" class="select-field">
              ${Array.from({length: 24}, (_, i) => `<option value="${i}" ${i === 17 ? 'selected' : ''}>${String(i).padStart(2, '0')}</option>`).join('')}
            </select>
            :
            <select id="minute-select" class="select-field">
              ${Array.from({length: 12}, (_, i) => `<option value="${i*5}" ${i*5 === 0 ? 'selected' : ''}>${String(i*5).padStart(2, '0')}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="section calendar-section">
          <h3>4. Select Assignment Dates (Deadlines)</h3>
          <div id="calendar-container"></div>
        </div>

        <div id="selected-dates-preview-section" class="section dates-preview hidden">
          <h3>5. Preview Selected Dates</h3>
          <div class="dates-table-container">
            <table id="dates-table">
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
        </div>

        <div class="section actions-section">
          <button id="generate-btn" class="btn btn-primary" disabled>Generate Batch MBZ</button>
          <div id="status-message" class="status-message"></div>
        </div>
      </div>
    `;
  }

  /**
   * Finds and stores references to important DOM elements.
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
      calendarContainer: this.container.querySelector('#calendar-container'),
      previewSection: this.container.querySelector('#selected-dates-preview-section'),
      previewTbody: this.container.querySelector('#dates-tbody'),
      generateBtn: this.container.querySelector('#generate-btn'),
      statusMessage: this.container.querySelector('#status-message'),
    };
     console.log("Found UI elements:", this.elements);
     if (!this.elements.sectionTitleInput) console.warn("Could not find #mbzSectionTitle input");
     if (!this.elements.targetStartDateInput) console.warn("Could not find #mbzTargetStartDate input");
  }

  /**
   * Initializes the flatpickr calendar instance.
   */
  initFlatpickr() {
    if (!this.elements.calendarContainer) return;
    this.calendar = flatpickr(this.elements.calendarContainer, {
      inline: true,         // Show calendar inline
      mode: "multiple",     // Allow selecting multiple dates
      dateFormat: "Y-m-d",   // Store dates in this format internally
      minDate: "today",     // Don't allow past dates
      showMonths: 2,        // Show two months for better context
      onChange: (selectedDates) => this.handleDateSelection(selectedDates),
      // Add more config as needed (localization, etc.)
    });
  }

  /**
   * Attaches event listeners to interactive elements.
   */
  attachEventListeners() {
    this.elements.selectMbzBtn?.addEventListener('click', () => this.selectMbzFile());
    this.elements.generateBtn?.addEventListener('click', () => this.generateBatchAssignments());

    // Update preview whenever relevant inputs change
    this.elements.namePrefixInput?.addEventListener('input', () => this.updatePreview());
    this.elements.hourSelect?.addEventListener('change', () => this.updatePreview());
    this.elements.minuteSelect?.addEventListener('change', () => this.updatePreview());
  }

  /**
   * Handles the selection of the template MBZ file.
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
        this.setStatus('Template file selected. Now select dates.', 'info');
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
   * Handles date selection from the calendar.
   */
  handleDateSelection(selectedDates) {
    this.selectedDates = selectedDates;
    this.updatePreview();
    this.updateGenerateButtonState();
  }

  /**
   * Updates the preview section with selected dates and timestamps.
   */
  updatePreview() {
    if (!this.elements.previewTbody || !this.elements.previewSection) return;
    
    if (this.selectedDates.length === 0) {
      this.elements.previewSection.classList.add('hidden');
      return;
    }

    // Sort dates chronologically
    const sortedDates = [...this.selectedDates].sort((a, b) => a.getTime() - b.getTime());
    const namePrefix = this.elements.namePrefixInput?.value || 'Assignment';
    const hour = parseInt(this.elements.hourSelect?.value || '17', 10);
    const minute = parseInt(this.elements.minuteSelect?.value || '0', 10);

    // Clear existing entries
    this.elements.previewTbody.innerHTML = '';

    // Build rows for all assignments
    sortedDates.forEach((date, index) => {
      const dueDate = new Date(date);
      dueDate.setHours(hour, minute, 0, 0);
      
      let availDate = index > 0 ? new Date(sortedDates[index-1]) : new Date(); 
      availDate.setHours(hour, minute, 0, 0);
      
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${namePrefix} ${index + 1}</td>
        <td>${dueDate.toLocaleString()}</td>
        <td>${availDate.toLocaleString()}</td>
      `;
      this.elements.previewTbody.appendChild(row);
    });

    // Show the preview section
    this.elements.previewSection.classList.remove('hidden');
  }

  /**
   * Updates the generate button state based on needed inputs.
   */
  updateGenerateButtonState() {
    if (this.elements.generateBtn) {
      this.elements.generateBtn.disabled = !this.mbzPath || this.selectedDates.length === 0;
    }
  }

  /**
   * Sets status message with class-based styling.
   */
  setStatus(message, type = 'info') {
    if (this.elements.statusMessage) {
      this.elements.statusMessage.textContent = message;
      this.elements.statusMessage.className = `status-message ${type}`;
    }
  }

  /**
   * Handles the generation of batch assignments.
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
      // Get values from NEW elements
      const sectionTitle = this.elements.sectionTitleInput?.value.trim() || null;
      const targetStartDate = this.elements.targetStartDateInput?.value || null; // Expects YYYY-MM-DD

      // Prepare options for backend
      const outputDir = await window.electronAPI.pathDirname(this.mbzPath);
      
      const options = {
        mbzFilePath: this.mbzPath,
        // Pass selectedDates directly (assuming they are Date objects from flatpickr)
        // The main process handler now expects date strings, so format them here
        selectedDates: this.selectedDates.map(date => this.calendar.formatDate(date, "Y-m-d")).sort(),
        timeHour: timeHour,
        timeMinute: timeMinute,
        namePrefix: namePrefix,
        outputDir: outputDir, // Pass output dir based on input
        // Add the new values
        sectionTitle: sectionTitle,
        targetStartDate: targetStartDate,
      };
      
      console.log("UI: Sending options to main process:", options); // Log what the UI is sending

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
   * Static factory method to create the UI.
   */
  static initialize(container) {
    return new MbzBatchCreatorUI(container);
  }
}

// Expose the class to the global scope
window.MbzBatchCreatorUI = MbzBatchCreatorUI;

// Remove the standalone setup function if the class is used
// function setupMbzBatchModal() { ... }
// document.addEventListener('DOMContentLoaded', setupMbzBatchModal); 