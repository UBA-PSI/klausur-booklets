/**
 * Vertical Calendar Controller
 * Extends the VerticalCalendar functionality to improve multi-selection
 */
class VerticalCalendarController {
  /**
   * Initialize the controller
   * @param {VerticalCalendar} calendar - The vertical calendar instance to control
   * @param {MbzBatchCreator} mbzInstance - The MBZ Batch Creator instance
   */
  constructor(calendar, mbzInstance) {
    this.calendar = calendar;
    this.mbzCreator = mbzInstance; // Store reference to MbzBatchCreator
    this.selectedDates = []; // Manage selection state here

    // Preview related elements
    this.namePrefixInput = null;
    this.deadlineTimeInput = null;
    this.gracePeriodInput = null;
    this.previewTbody = null;
    this.previewSection = null;

    // Click handler reference
    this.clickHandler = null;

    // Initialize the controller
    this.init();
  }

  /**
   * Initialize the controller
   */
  init() {
    // Find preview elements (best effort, might need re-finding in updatePreview)
    this.namePrefixInput = document.getElementById('name-prefix-input');
    this.deadlineTimeInput = document.getElementById('deadlineTime');
    this.gracePeriodInput = document.getElementById('gracePeriod');
    this.previewTbody = document.getElementById('dates-tbody');
    this.previewSection = document.getElementById('selected-dates-preview-section');

    // Ensure the preview section is visible from the start
    if (this.previewSection) {
      this.previewSection.style.display = 'block';
      this.previewSection.classList.remove('hidden');
    }

    // Attach input listeners for live preview updates
    this.namePrefixInput?.addEventListener('input', () => this.updatePreview());
    this.deadlineTimeInput?.addEventListener('input', () => this.updatePreview());
    this.gracePeriodInput?.addEventListener('change', () => this.updatePreview());

    // Add CSS for selection highlights and feedback
    this.injectStyles();

    // Use a delegated click handler for date selection
    this.attachDelegatedClickHandler();

    // Listen for calendar re-renders to reapply highlights
    this.calendar.container.addEventListener('calendarRendered', () => {
      this.reapplyHighlights();
    });

    // Initial application of highlights and preview
    this.reapplyHighlights();
    this.updatePreview();
  }

  /**
   * Inject necessary CSS styles
   */
  injectStyles() {
    const styleId = 'vertical-calendar-controller-styles';
    if (document.getElementById(styleId)) return; // Inject only once

    const styles = document.createElement('style');
    styles.id = styleId;
    styles.textContent = `
      /* Custom selection styles */
      .calendar-day.direct-selected {
        background-color: #cfe2ff !important; /* Use important to override base styles */
        color: #0d6efd !important;
        font-weight: bold !important;
        position: relative;
        border: 1px solid #a6c8ff !important; /* Add a border for more emphasis */
        box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.1);
      }
      
      /* Display index number on selected days */
      .calendar-day.direct-selected::after {
        /* Use a data attribute set by JS for the content */
        content: attr(data-selection-index); 
        position: absolute;
        top: 1px; /* Adjust position */
        right: 3px; /* Adjust position */
        font-size: 10px; /* Smaller font size for index */
        color: #0a58ca; /* Slightly darker blue */
        font-weight: bold;
        padding: 0 2px; /* Add slight padding */
        line-height: 1; /* Ensure consistent line height */
        min-width: 8px; /* Ensure minimum width */
        text-align: center; /* Center text within pseudo-element */
        background-color: rgba(255, 255, 255, 0.6); /* Optional: slight background for readability */
        border-radius: 2px; /* Optional: slightly rounded corners */
      }
      
      /* Animation for click feedback */
      @keyframes clickPulse {
        0% { transform: scale(1); box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.1); }
        50% { transform: scale(1.05); box-shadow: inset 0 0 8px rgba(13, 110, 253, 0.3); }
        100% { transform: scale(1); box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.1); }
      }
      
      .calendar-day.click-pulse {
        animation: clickPulse 0.3s ease-out;
      }
      
      /* Ensure preview section is always visible if handled by JS */
      #selected-dates-preview-section { 
        display: block !important; 
      }
    `;
    document.head.appendChild(styles);
  }

  /**
   * Attach a single click handler to the calendar container
   */
  attachDelegatedClickHandler() {
    // Remove existing handler if present
    if (this.clickHandler) {
      this.calendar.container.removeEventListener('click', this.clickHandler, true);
    }

    this.clickHandler = (event) => {
      const dateElement = event.target.closest('.calendar-day');
      if (!dateElement) return;

      // Prevent original calendar handlers and default behavior
      event.preventDefault();
      event.stopPropagation();

      // Only handle clicks on valid date elements
      if (dateElement.classList.contains('other-month') || dateElement.classList.contains('past')) {
        return;
      }

      // Add visual feedback
      dateElement.classList.add('click-pulse');
      setTimeout(() => dateElement.classList.remove('click-pulse'), 300);

      const dateStr = dateElement.dataset.date;
      if (!dateStr) return;

      // Parse YYYY-MM-DD string as UTC date
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1, day)); // month is 0-indexed

      // Toggle selection logic
      const dateIndex = this.selectedDates.findIndex(d => this.formatDateString(d) === dateStr);
      if (dateIndex !== -1) {
        // Date exists, remove it
        this.selectedDates.splice(dateIndex, 1);
      } else {
        // Date doesn't exist, add it
        this.selectedDates.push(date);
        // Keep sorted
        this.selectedDates.sort((a, b) => a.getTime() - b.getTime());
      }

      // Reapply all highlights and indices based on the updated sorted array
      this.reapplyHighlights();

      // Update the batch creator and the preview table
      this.updateBatchCreatorDates();
      this.updatePreview();
    };

    // Add the handler in the capture phase to run before potential default handlers
    this.calendar.container.addEventListener('click', this.clickHandler, true);
  }

  /**
   * Refresh the controller (e.g., after calendar re-renders)
   */
  refresh() {
    // Re-attach click handlers if needed (delegated might not need this, but good practice)
    this.attachDelegatedClickHandler();
    // Reapply visual selection state and indices
    this.reapplyHighlights();
    // Update preview
    this.updatePreview();
  }

  /**
   * Re-apply the 'direct-selected' class and index data attribute based on the internal selectedDates array
   */
  reapplyHighlights() {
    if (!this.calendar || !this.calendar.container) return;

    // Clear existing highlights and indices first
    this.calendar.container.querySelectorAll('.calendar-day.direct-selected')
      .forEach(el => {
        el.classList.remove('direct-selected');
        delete el.dataset.selectionIndex;
      });

    // Apply highlights and indices based on the sorted selectedDates
    this.selectedDates.forEach((date, index) => { // Index is 0-based here
      const dateStr = this.formatDateString(date); // Use UTC formatter
      const dayEl = this.calendar.container.querySelector(`.calendar-day[data-date="${dateStr}"]`);
      if (dayEl && !dayEl.classList.contains('other-month') && !dayEl.classList.contains('past')) {
        dayEl.classList.add('direct-selected');
        dayEl.dataset.selectionIndex = index + 1;
      }
    });
  }

  /**
   * Update the preview table based on selected dates and input values
   */
  updatePreview() {
    // Ensure elements are available (re-find if needed)
    if (!this.previewTbody) this.previewTbody = document.getElementById('dates-tbody');
    if (!this.previewSection) this.previewSection = document.getElementById('selected-dates-preview-section');

    if (!this.previewTbody || !this.previewSection) {
      console.error("Preview elements not found for update!");
      return;
    }

    // Show/hide the section based on whether dates are selected
    const hasSelection = this.selectedDates.length > 0;
    this.previewSection.style.display = hasSelection ? 'block' : 'none';
    this.previewSection.classList.toggle('hidden', !hasSelection);

    // Clear the table body
    this.previewTbody.innerHTML = '';

    // Skip the rest if no dates are selected
    if (!hasSelection) {
      return;
    }

    // Get input values (re-find inputs just in case they weren't ready initially)
    if (!this.namePrefixInput) this.namePrefixInput = document.getElementById('name-prefix-input');
    if (!this.deadlineTimeInput) this.deadlineTimeInput = document.getElementById('deadlineTime');

    const namePrefix = this.namePrefixInput?.value || 'Assignment';
    let hour = 17, minute = 0;

    if (this.deadlineTimeInput && this.deadlineTimeInput.value) {
      const timeParts = this.deadlineTimeInput.value.split(':');
      if (timeParts.length >= 2) {
        hour = parseInt(timeParts[0], 10);
        minute = parseInt(timeParts[1], 10);
        // Ignore seconds for calculation simplicity if present
      }
    }

    // Use the already sorted internal selectedDates
    const sortedDates = this.selectedDates;

    // Build the table rows
    sortedDates.forEach((date, index) => {
      const [dueYear, dueMonth, dueDay] = this.formatDateString(date).split('-');
      const dueHourStr = hour.toString().padStart(2, '0');
      const dueMinuteStr = minute.toString().padStart(2, '0');
      const formattedDueDate = `${dueDay}/${dueMonth}/${dueYear}, ${dueHourStr}:${dueMinuteStr}:00`;

      let formattedAvailDate = 'N/A'; // Default for the first assignment

      if (index > 0) {
        const prevDueDate = sortedDates[index - 1];
        // Calculate availability time based on previous UTC due date + 1 minute
        const availTimeMillis = Date.UTC(prevDueDate.getUTCFullYear(), prevDueDate.getUTCMonth(), prevDueDate.getUTCDate(), hour, minute, 0) + 60000;
        const availDate = new Date(availTimeMillis);

        // Format Available Date using its UTC parts
        const [availYear, availMonth, availDay] = this.formatDateString(availDate).split('-');
        const availHourStr = availDate.getUTCHours().toString().padStart(2, '0');
        const availMinuteStr = availDate.getUTCMinutes().toString().padStart(2, '0');
        const availSecondStr = availDate.getUTCSeconds().toString().padStart(2, '0');
        formattedAvailDate = `${availDay}/${availMonth}/${availYear}, ${availHourStr}:${availMinuteStr}:${availSecondStr}`;
      } else {
         // Default availability for the first assignment: start of today (local time)
        const now = new Date();
        const todayDay = now.getDate().toString().padStart(2, '0');
        const todayMonth = (now.getMonth() + 1).toString().padStart(2, '0');
        const todayYear = now.getFullYear();
        formattedAvailDate = `${todayDay}/${todayMonth}/${todayYear}, 00:00:00`;
      }

      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${index + 1}</td>
        <td>${namePrefix} ${index + 1}</td>
        <td>${formattedDueDate}</td>
        <td>${formattedAvailDate}</td>
      `;
      this.previewTbody.appendChild(row);
    });
  }

  /**
   * Update the MbzBatchCreator instance with the current selection
   */
  updateBatchCreatorDates() {
    if (this.mbzCreator && typeof this.mbzCreator.updateSelectedDates === 'function') {
      this.mbzCreator.updateSelectedDates(this.selectedDates);
    } else {
      // Log error if instance or method is missing - might happen briefly during init
      // console.warn('MbzBatchCreator instance or updateSelectedDates method not available yet.');
    }
  }

  /**
   * Helper method to format a date as YYYY-MM-DD using UTC components
   * @param {Date} date - The date to format
   * @returns {string} Date string in YYYY-MM-DD format
   */
  formatDateString(date) {
    if (!(date instanceof Date) || isNaN(date)) {
        // console.warn("formatDateString received invalid date:", date);
        return 'Invalid Date'; // Or handle appropriately
    }
    const year = date.getUTCFullYear();
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Clears the current date selection, updates UI, and notifies MbzBatchCreator.
   */
  clearSelection() {
    this.selectedDates = [];
    this.reapplyHighlights(); // This will clear existing highlights and indices
    this.updatePreview();
    this.updateBatchCreatorDates(); // Notify the batch creator
  }

  /**
   * Static factory method to create and initialize the controller
   * @param {VerticalCalendar} calendar - The vertical calendar instance
   * @param {MbzBatchCreator} mbzInstance - The MBZ Batch Creator instance
   * @returns {VerticalCalendarController | null} The controller instance or null if init fails
   */
  static initialize(calendar, mbzInstance) {
    if (!calendar || !calendar.container) {
      console.error("Calendar instance or container not provided for controller initialization.");
      return null;
    }
    if (!mbzInstance) {
      console.warn("MbzBatchCreator instance not provided during controller initialization. Some features might be limited.");
      // Proceeding without mbzInstance might be acceptable depending on requirements
    }
    try {
      const controller = new VerticalCalendarController(calendar, mbzInstance);
      // Make the clearSelection method globally accessible IF the controller initialized
      if (controller) {
          window.VerticalCalendarControllerAPI = {
              clearSelection: controller.clearSelection.bind(controller)
          };
      }
      console.log('Vertical Calendar Controller initialized successfully.');
      return controller;
    } catch (error) {
      console.error('Error initializing VerticalCalendarController:', error);
      return null;
    }
  }
}

// Expose the Class itself to global scope (optional, but useful for debugging/initialization)
window.VerticalCalendarController = VerticalCalendarController; 