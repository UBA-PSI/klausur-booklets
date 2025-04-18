/**
 * Vertical Calendar Controller
 * Extends the VerticalCalendar functionality to improve multi-selection
 */
class VerticalCalendarController {
  /**
   * Initialize the controller
   * @param {VerticalCalendar} calendar - The vertical calendar instance to control
   */
  constructor(calendar) {
    this.calendar = calendar;
    this.isCtrlPressed = false;
    this.isShiftPressed = false;
    this.lastSelectedDate = null;

    // Initialize the controller
    this.init();
  }

  /**
   * Initialize the controller
   */
  init() {
    // Attach keyboard event listeners
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
    document.addEventListener('keyup', this.handleKeyUp.bind(this));

    // Override the calendar's click handler to implement our multi-selection logic
    this.overrideCalendarClickHandler();
  }

  /**
   * Handle key down events
   * @param {KeyboardEvent} event - The keyboard event
   */
  handleKeyDown(event) {
    if (event.key === 'Control' || event.key === 'Meta') {
      this.isCtrlPressed = true;
    } else if (event.key === 'Shift') {
      this.isShiftPressed = true;
    }
  }

  /**
   * Handle key up events
   * @param {KeyboardEvent} event - The keyboard event
   */
  handleKeyUp(event) {
    if (event.key === 'Control' || event.key === 'Meta') {
      this.isCtrlPressed = false;
    } else if (event.key === 'Shift') {
      this.isShiftPressed = false;
    }
  }

  /**
   * Override the calendar's click handler
   */
  overrideCalendarClickHandler() {
    // Instead of replacing each element's click handler,
    // add a single capture-phase handler to the container
    // Remove any existing handlers we've added
    if (this.clickHandler) {
      this.calendar.container.removeEventListener('click', this.clickHandler, true);
    }
    
    // Define our click handler
    this.clickHandler = (event) => {
      const dateElement = event.target.closest('.calendar-day');
      if (!dateElement) return;
      
      this.handleDateClick(event, dateElement);
    };
    
    // Add our handler in the capture phase
    this.calendar.container.addEventListener('click', this.clickHandler, true);
  }

  /**
   * Handle date click with enhanced multi-selection
   * @param {MouseEvent} event - The mouse event
   * @param {HTMLElement} dateElement - The date element that was clicked
   */
  handleDateClick(event, dateElement) {
    // Prevent the default click behavior
    event.preventDefault();
    event.stopPropagation();
    
    // Skip processing for past dates or dates in other months
    if (dateElement.classList.contains('past') || dateElement.classList.contains('other-month')) {
      return;
    }
    
    // Get the date from the cell
    const dateStr = dateElement.dataset.date;
    if (!dateStr) return;
    
    const date = new Date(dateStr);
    
    // If neither ctrl nor shift is pressed, clear selection unless it's a toggle
    if (!this.isCtrlPressed && !this.isShiftPressed) {
      // Check if this date is already selected (for toggle behavior)
      const isSelected = dateElement.classList.contains('direct-selected');
      
      // If not a toggle, clear all selections
      if (!isSelected) {
        this.calendar.selectedDates = [];
        this.calendar.container.querySelectorAll('.direct-selected').forEach(el => {
          el.classList.remove('direct-selected');
        });
      }
    }
    
    // Handle shift selection (range select)
    if (this.isShiftPressed && this.lastSelectedDate) {
      const start = new Date(Math.min(this.lastSelectedDate.getTime(), date.getTime()));
      const end = new Date(Math.max(this.lastSelectedDate.getTime(), date.getTime()));
      
      // Select all dates in the range
      this.calendar.container.querySelectorAll('.calendar-day').forEach(el => {
        // Skip processing for past dates or dates in other months
        if (el.classList.contains('past') || el.classList.contains('other-month')) {
          return;
        }
        
        const cellDate = new Date(el.dataset.date);
        if (cellDate >= start && cellDate <= end) {
          el.classList.add('direct-selected');
          this.addDateToSelection(cellDate);
        }
      });
    } else {
      // Toggle the selected state of the clicked date
      if (dateElement.classList.contains('direct-selected')) {
        dateElement.classList.remove('direct-selected');
        this.removeDateFromSelection(date);
      } else {
        dateElement.classList.add('direct-selected');
        this.addDateToSelection(date);
      }
      
      // Update last selected date
      this.lastSelectedDate = date;
    }
    
    // Trigger the onDateSelect callback with updated selection
    if (this.calendar.options.onDateSelect) {
      this.calendar.options.onDateSelect(this.calendar.selectedDates);
    }
    
    // Update the existing calendar controller if it exists
    if (window.calendarController && window.calendarController.updatePreview) {
      // Sync our selections with the calendar-fix.js controller
      window.calendarController.selectedDates = [...this.calendar.selectedDates];
      // Ask it to update the preview
      window.calendarController.updatePreview();
    }
  }

  /**
   * Add a date to the calendar's selection
   * @param {Date} date - The date to add
   */
  addDateToSelection(date) {
    // Check if date already exists in the selection
    const exists = this.calendar.selectedDates.some(d => 
      d.getFullYear() === date.getFullYear() && 
      d.getMonth() === date.getMonth() && 
      d.getDate() === date.getDate()
    );
    
    if (!exists) {
      this.calendar.selectedDates.push(new Date(date));
    }
  }

  /**
   * Remove a date from the calendar's selection
   * @param {Date} date - The date to remove
   */
  removeDateFromSelection(date) {
    this.calendar.selectedDates = this.calendar.selectedDates.filter(d => 
      d.getFullYear() !== date.getFullYear() || 
      d.getMonth() !== date.getMonth() || 
      d.getDate() !== date.getDate()
    );
  }

  /**
   * Refresh the controller (e.g., after calendar re-renders)
   */
  refresh() {
    // Reattach click handlers
    this.overrideCalendarClickHandler();
    
    // Reapply highlights based on selected dates
    if (this.calendar && this.calendar.selectedDates && this.calendar.selectedDates.length > 0) {
      // Clear existing highlights first
      this.calendar.container.querySelectorAll('.direct-selected').forEach(el => {
        el.classList.remove('direct-selected');
      });
      
      // Apply highlights for each selected date
      this.calendar.selectedDates.forEach(date => {
        const dateStr = this.formatDateString(date);
        const el = this.calendar.container.querySelector(`.calendar-day[data-date="${dateStr}"]`);
        if (el) {
          el.classList.add('direct-selected');
        }
      });
    }
    
    // Sync with calendarController if it exists
    if (window.calendarController && window.calendarController.selectedDates) {
      window.calendarController.selectedDates = [...this.calendar.selectedDates];
      if (window.calendarController.updatePreview) {
        window.calendarController.updatePreview();
      }
    }
  }
  
  /**
   * Format a date as YYYY-MM-DD string
   * @param {Date} date - The date to format
   * @returns {string} - The formatted date string
   */
  formatDateString(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Static method to initialize the controller for an existing calendar
   * @param {VerticalCalendar} calendar - The vertical calendar instance
   * @returns {VerticalCalendarController} The controller instance
   */
  static initialize(calendar) {
    return new VerticalCalendarController(calendar);
  }
}

// Expose to global scope
window.VerticalCalendarController = VerticalCalendarController; 