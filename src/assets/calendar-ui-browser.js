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
    // Use template literals and Bootstrap classes for better structure
    this.container.innerHTML = `
      <style>
        /* Attempt to fix flatpickr day alignment in the last row */
        .flatpickr-day {
          flex-grow: 0 !important; /* Prevent days from stretching to fill space */
        }
        .flatpickr-days {
           justify-content: flex-start; /* Align day container items to the start */
        }
        .calendar-controls {
          margin-bottom: 1rem; /* Add space below the add weeks button */
          text-align: right; /* Align button to the right */
        }
        .dates-table-container {
            max-height: 300px; /* Limit preview height */
            overflow-y: auto; /* Add scroll if needed */
        }
        .hidden {
          display: none;
        }
        .status-message {
          margin-top: 1rem;
          padding: 0.5rem;
          border-radius: 4px;
          font-size: 0.9em;
        }
        .status-message.info { background-color: #e7f3fe; border: 1px solid #d0eaff; color: #084298; }
        .status-message.success { background-color: #d1e7dd; border: 1px solid #badbcc; color: #0f5132; }
        .status-message.error { background-color: #f8d7da; border: 1px solid #f5c2c7; color: #842029; }

      </style>
      <div class="mbz-creator p-3">
        <h2>Batch Assignment Creator</h2>
        <hr/>

        <div class="row g-3 mb-4">
          <div class="col-md-6">
            <h5>1. Select Template MBZ</h5>
            <div class="mb-3">
                <button id="select-mbz-btn" class="btn btn-secondary">Select MBZ File</button>
                <span id="selected-file-label" class="ms-2 fst-italic">No file selected</span>
                <div class="form-text">Select the '.mbz' template file provided with the script.</div>
            </div>
          </div>
          <div class="col-md-6">
            <h5>2. Configure Assignment Details</h5>
             <div class="mb-3">
                <label for="name-prefix-input" class="form-label">Assignment Name Prefix:</label>
                <input type="text" id="name-prefix-input" class="form-control form-control-sm" placeholder="e.g., Weekly Assignment" value="Booklet Page">
                <div class="form-text">Prefix used for naming assignments (e.g., "Booklet Page 1", "Booklet Page 2").</div>
             </div>
          </div>
        </div>

        <div class="row g-3 mb-4">
          <div class="col-md-6">
             <div class="mb-3">
                <label for="mbzSectionTitle" class="form-label">Moodle Section Title:</label>
                <input type="text" class="form-control form-control-sm" id="mbzSectionTitle" placeholder="e.g., Exam Booklet Pages">
                <div class="form-text">Exact title of the section in your Moodle course where assignments will be added.</div>
             </div>
          </div>
           <div class="col-md-6">
             <div class="mb-3">
                <label for="mbzTargetStartDate" class="form-label">Moodle Course Start Date:</label>
                <input type="date" class="form-control form-control-sm" id="mbzTargetStartDate">
                 <div class="form-text">Must match the start date of the target Moodle course (used for correct date import). Set course start time to 00:00.</div>
             </div>
          </div>
        </div>


        <div class="row g-3 mb-4">
          <div class="col-12">
             <h5>3. Set Default Deadline Time</h5>
             <div class="d-flex align-items-center">
                <label for="hour-select" class="form-label me-2">Time:</label>
                <select id="hour-select" class="form-select form-select-sm me-1" style="width: auto;">
                  ${Array.from({length: 24}, (_, i) => `<option value="${i}" ${i === 17 ? 'selected' : ''}>${String(i).padStart(2, '0')}</option>`).join('')}
                </select>
                :
                <select id="minute-select" class="form-select form-select-sm ms-1" style="width: auto;">
                  ${Array.from({length: 12}, (_, i) => `<option value="${i*5}" ${i*5 === 0 ? 'selected' : ''}>${String(i*5).padStart(2, '0')}</option>`).join('')}
                </select>
             </div>
             <div class="form-text">Default time for all assignment deadlines (e.g., 17:00 for 5 PM).</div>
          </div>
        </div>

        <div class="row g-3 mb-4">
          <div class="col-12">
            <h5>4. Select Assignment Dates (Deadlines)</h5>
             <div class="calendar-controls">
                <button id="add-weeks-btn" class="btn btn-sm btn-outline-secondary">Add Next 4 Weeks</button>
             </div>
            <div id="calendar-container"></div>
             <div class="form-text">Click dates on the calendar to set assignment deadlines. Use 'Add Next 4 Weeks' to quickly add weekly dates based on the last selected date.</div>
          </div>
        </div>

        <div id="selected-dates-preview-section" class="mb-4 hidden">
          <h5>5. Preview Selected Dates</h5>
          <div class="dates-table-container border rounded p-2">
            <table id="dates-table" class="table table-sm table-striped table-hover">
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
           <div class="form-text">Review the generated assignment names and deadlines. 'Available From' is based on the previous assignment's due date.</div>
        </div>

        <hr/>
        <div class="actions-section text-center">
          <button id="generate-btn" class="btn btn-primary" disabled>Generate Batch MBZ File</button>
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
      addWeeksBtn: this.container.querySelector('#add-weeks-btn'), // Find the new button
      previewSection: this.container.querySelector('#selected-dates-preview-section'),
      previewTbody: this.container.querySelector('#dates-tbody'),
      generateBtn: this.container.querySelector('#generate-btn'),
      statusMessage: this.container.querySelector('#status-message'),
    };
     console.log("Found UI elements:", this.elements);
     if (!this.elements.sectionTitleInput) console.warn("Could not find #mbzSectionTitle input");
     if (!this.elements.targetStartDateInput) console.warn("Could not find #mbzTargetStartDate input");
     if (!this.elements.addWeeksBtn) console.warn("Could not find #add-weeks-btn button"); // Check for new button
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
    this.elements.addWeeksBtn?.addEventListener('click', () => this.addNextFourWeeks()); // Add listener for new button

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
      // Set availability based on the previous assignment's due date + 1 minute (or now if first assignment)
      if (index > 0) {
          availDate = new Date(sortedDates[index-1]);
          availDate.setHours(hour, minute, 0, 0);
          // Optional: Add a small buffer, e.g., 1 minute after the previous deadline
          availDate.setMinutes(availDate.getMinutes() + 1);
      } else {
          // First assignment available immediately (or consider course start date?)
          availDate = new Date(); // Or a fixed starting point if needed
           // Set time to 00:00:00 for the very first availability? Or match deadline time? Let's stick to deadline time for consistency
          availDate.setHours(0, 0, 0, 0); // Start of day for first assignment availability
      }
      
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

      // --- Validation ---
       if (!targetStartDate) {
           this.setStatus('Please provide the Moodle Course Start Date.', 'error');
           this.elements.targetStartDateInput?.focus();
           this.elements.generateBtn.disabled = false; // Re-enable button
           return;
       }
       // Basic date format check (doesn't guarantee validity but catches common errors)
       if (!/^\d{4}-\d{2}-\d{2}$/.test(targetStartDate)) {
           this.setStatus('Moodle Course Start Date must be in YYYY-MM-DD format.', 'error');
            this.elements.targetStartDateInput?.focus();
            this.elements.generateBtn.disabled = false; // Re-enable button
            return;
       }
      // ------------------

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
   * Adds the next four weeks of dates based on the latest selected date.
   */
  addNextFourWeeks() {
    if (!this.calendar) return;

    const currentDates = this.calendar.selectedDates;
    if (currentDates.length === 0) {
        this.setStatus("Please select at least one date first.", "info");
        return;
    }

    // Sort dates to find the latest one
    const sortedDates = [...currentDates].sort((a, b) => b.getTime() - a.getTime());
    const latestDate = new Date(sortedDates[0]); // Get the most recent date

    const newDates = [];
    for (let i = 1; i <= 4; i++) {
        const nextDate = new Date(latestDate);
        nextDate.setDate(latestDate.getDate() + (7 * i)); // Add 7 days * i weeks
        // Check if the date is valid and not in the past (though minDate should handle this)
        if (!isNaN(nextDate.getTime())) {
             // Check if the new date is already selected to avoid duplicates
             const dateStr = this.calendar.formatDate(nextDate, "Y-m-d");
             const isAlreadySelected = currentDates.some(d => this.calendar.formatDate(d, "Y-m-d") === dateStr);
             if (!isAlreadySelected) {
                 newDates.push(nextDate);
             }
        }
    }

    if (newDates.length > 0) {
        const allDates = [...currentDates, ...newDates];
        // Set the new selection in the calendar
        this.calendar.setDate(allDates, true); // true triggers onChange
        this.setStatus(`Added ${newDates.length} weekly dates.`, "info");
    } else {
        this.setStatus("No new future weekly dates could be added.", "info");
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