// Handles the frontend UI logic for the MBZ Batch Creator using flatpickr.

// Dependencies (assuming flatpickr CSS is loaded globally or via build process)
const flatpickr = require('flatpickr');
const { createBatchAssignments } = require('./index'); // Core backend function
const { formatTimestamp } = require('./utils'); // Date formatting utility

// Electron dependencies (assuming running in renderer process with nodeIntegration or contextBridge)
// Use require directly if nodeIntegration is enabled, otherwise use exposed API via contextBridge
let dialog, path;
try {
  // If contextIsolation is on, these might be exposed via contextBridge
  dialog = window.electron?.dialog || require('@electron/remote').dialog;
  path = window.electron?.path || require('path');
} catch (e) {
  console.error('Electron remote or path module not found. Ensure it is enabled or exposed via contextBridge.');
  // Provide dummy functions or throw error if essential
  dialog = {
      showOpenDialog: () => Promise.resolve({ canceled: true }),
      showMessageBox: (options) => console.warn('Dialog unavailable:', options.message)
  };
  path = {
      basename: (p) => p.split(/[/\\]/).pop(),
      dirname: (p) => p.substring(0, p.lastIndexOf('/')) || p.substring(0, p.lastIndexOf('\\'))
  };
}

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
      hourSelect: this.container.querySelector('#hour-select'),
      minuteSelect: this.container.querySelector('#minute-select'),
      calendarContainer: this.container.querySelector('#calendar-container'),
      previewSection: this.container.querySelector('#selected-dates-preview-section'),
      previewTbody: this.container.querySelector('#dates-tbody'),
      generateBtn: this.container.querySelector('#generate-btn'),
      statusMessage: this.container.querySelector('#status-message'),
    };
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
      const result = await dialog.showOpenDialog({
        title: 'Select Template MBZ File',
        properties: ['openFile'],
        filters: [{ name: 'Moodle Backup Files', extensions: ['mbz'] }]
      });

      if (!result.canceled && result.filePaths.length > 0) {
        this.mbzPath = result.filePaths[0];
        this.elements.selectedFileLabel.textContent = path.basename(this.mbzPath);
        this.elements.selectedFileLabel.title = this.mbzPath; // Show full path on hover
        this.updateGenerateButtonState();
        // TODO: Optionally add analysis here to show template details
        // e.g., call a simplified version of analyzeMbzTemplate or parts of it
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
      this.updateGenerateButtonState();
    }
  }

  /**
   * Handles changes in the calendar date selection.
   * @param {Date[]} selectedDates - Array of Date objects selected by flatpickr.
   */
  handleDateSelection(selectedDates) {
    // Sort dates chronologically before storing
    this.selectedDates = selectedDates.sort((a, b) => a.getTime() - b.getTime());
    this.updatePreview();
    this.updateGenerateButtonState();
  }

  /**
   * Updates the preview table based on current selections.
   */
  updatePreview() {
    if (!this.elements.previewTbody || !this.elements.previewSection) return;

    if (this.selectedDates.length === 0) {
      this.elements.previewSection.classList.add('hidden');
      return;
    }

    this.elements.previewSection.classList.remove('hidden');
    this.elements.previewTbody.innerHTML = ''; // Clear previous preview

    const hour = parseInt(this.elements.hourSelect.value, 10);
    const minute = parseInt(this.elements.minuteSelect.value, 10);
    const prefix = this.elements.namePrefixInput.value.trim() || 'Assignment';

    this.selectedDates.forEach((date, index) => {
      const row = this.elements.previewTbody.insertRow();

      const dueDate = new Date(date);
      dueDate.setHours(hour, minute, 0, 0);

      const availableDate = (index > 0)
        ? new Date(this.selectedDates[index - 1])
        : new Date(); // Use current time for the first assignment's availability

      if (index > 0) {
        availableDate.setHours(hour, minute, 0, 0); // Set time for previous due date
      }

      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${prefix} ${index + 1}</td>
        <td>${dueDate.toLocaleString()}</td>
        <td>${availableDate.toLocaleString()}</td>
      `;
    });
  }

  /**
   * Updates the enabled/disabled state of the generate button.
   */
  updateGenerateButtonState() {
    if (!this.elements.generateBtn) return;
    const enabled = this.mbzPath && this.selectedDates.length > 0;
    this.elements.generateBtn.disabled = !enabled;
  }

  /**
   * Sets a status message in the UI.
   * @param {string} message - The message text.
   * @param {'info'|'error'|'success'} type - Type of message for potential styling.
   */
  setStatus(message, type = 'info') {
    if (!this.elements.statusMessage) return;
    this.elements.statusMessage.textContent = message;
    this.elements.statusMessage.className = `status-message status-${type}`;
  }

  /**
   * Handles the click event for the generate button.
   */
  async generateBatchAssignments() {
    if (!this.mbzPath || this.selectedDates.length === 0) {
      this.setStatus('Please select an MBZ file and at least one date.', 'error');
      return;
    }

    this.setStatus('Generating batch assignments... Please wait.', 'info');
    this.elements.generateBtn.disabled = true;

    try {
      const options = {
        mbzFilePath: this.mbzPath,
        selectedDates: this.selectedDates, // Already sorted
        timeHour: parseInt(this.elements.hourSelect.value, 10),
        timeMinute: parseInt(this.elements.minuteSelect.value, 10),
        namePrefix: this.elements.namePrefixInput.value.trim() || 'Assignment',
        outputDir: path.dirname(this.mbzPath) // Save in the same directory as input
      };

      const result = await createBatchAssignments(options);

      if (result.success) {
        this.setStatus(`Success! ${result.message}`, 'success');
        dialog.showMessageBox({
          type: 'info',
          title: 'Batch Creation Successful',
          message: result.message,
          detail: `Generated file saved to:\n${result.outputPath}`
        });
        // Optionally clear the form or calendar
        // this.calendar.clear();
        // this.mbzPath = null;
        // this.elements.selectedFileLabel.textContent = 'No file selected';

      } else {
        throw new Error(result.message || 'An unknown error occurred during generation.');
      }
    } catch (error) {
      console.error('Error generating batch assignments:', error);
      this.setStatus(`Error: ${error.message}`, 'error');
      dialog.showMessageBox({
        type: 'error',
        title: 'Batch Creation Failed',
        message: 'Could not create the batch assignments.',
        detail: error.message || 'Unknown error'
      });
    } finally {
      this.elements.generateBtn.disabled = false; // Re-enable button even on error
    }
  }

  /**
   * Static method to easily initialize the UI from outside.
   * @param {string|HTMLElement} container - Either the ID of the container or the element itself.
   * @returns {MbzBatchCreatorUI} The initialized UI instance.
   */
  static initialize(container) {
    const containerElement = (typeof container === 'string')
      ? document.getElementById(container)
      : container;

    if (!containerElement) {
      console.error(`Container element not found: ${container}`);
      return null;
    }
    return new MbzBatchCreatorUI(containerElement);
  }
}

module.exports = MbzBatchCreatorUI; 