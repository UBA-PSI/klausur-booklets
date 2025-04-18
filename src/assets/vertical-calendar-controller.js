/**
 * VerticalCalendarController
 * Extends the VerticalCalendar component with multi-selection capabilities
 * including Ctrl+Click and Shift+Click support
 */
class VerticalCalendarController {
  /**
   * Initialize the controller
   * @param {VerticalCalendar} calendar - The calendar instance to control
   */
  constructor(calendar) {
    this.calendar = calendar;
    this.container = calendar.container;
    this.lastSelectedDate = null;
    this.isCtrlPressed = false;
    this.isShiftPressed = false;
    this.selectedDates = [];
    
    // Initialize controller
    this.init();
  }
  
  /**
   * Initialize the controller with event listeners
   */
  init() {
    // Attach keyboard listeners for Ctrl and Shift keys
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
    document.addEventListener('keyup', this.handleKeyUp.bind(this));
    
    // Override the calendar's click handler
    this.attachDateClickHandlers();
    
    // Initialize with any pre-selected dates
    if (this.calendar.selectedDates && this.calendar.selectedDates.length > 0) {
      this.selectedDates = [...this.calendar.selectedDates];
      this.refresh();
    }
  }
  
  /**
   * Handle keydown events to track modifier keys
   */
  handleKeyDown(event) {
    if (event.key === 'Control' || event.key === 'Meta') {
      this.isCtrlPressed = true;
    } else if (event.key === 'Shift') {
      this.isShiftPressed = true;
    }
  }
  
  /**
   * Handle keyup events to track modifier keys
   */
  handleKeyUp(event) {
    if (event.key === 'Control' || event.key === 'Meta') {
      this.isCtrlPressed = false;
    } else if (event.key === 'Shift') {
      this.isShiftPressed = false;
    }
  }
  
  /**
   * Attach click handlers to date elements
   */
  attachDateClickHandlers() {
    // Remove any existing click handlers
    const dateElements = this.container.querySelectorAll('.calendar-day[data-date]');
    dateElements.forEach(el => {
      // Clear any existing handlers by cloning the element
      const newEl = el.cloneNode(true);
      el.parentNode.replaceChild(newEl, el);
      
      // Add our custom handler
      newEl.addEventListener('click', (event) => {
        this.handleDateClick(newEl, event);
      });
    });
    
    // Listen for calendar render events to reattach handlers
    this.container.addEventListener('calendarRendered', () => {
      setTimeout(() => this.attachDateClickHandlers(), 0);
    });
  }
  
  /**
   * Handle date click with multi-selection support
   */
  handleDateClick(dateEl, event) {
    if (!dateEl.hasAttribute('data-date') || dateEl.classList.contains('past') || dateEl.classList.contains('other-month')) {
      return; // Don't handle clicks on disabled dates
    }
    
    const dateStr = dateEl.getAttribute('data-date');
    const clickedDate = new Date(dateStr + 'T00:00:00'); // Create date object
    
    // Handle selection based on modifier keys
    if (this.isShiftPressed && this.lastSelectedDate) {
      // Shift+Click: Select range
      this.selectDateRange(this.lastSelectedDate, clickedDate);
    } else if (this.isCtrlPressed) {
      // Ctrl+Click: Toggle single date
      this.toggleDate(clickedDate);
    } else {
      // Normal click: Replace selection with single date
      this.selectedDates = [clickedDate];
    }
    
    // Update the last selected date
    this.lastSelectedDate = clickedDate;
    
    // Update the calendar UI
    this.refresh();
    
    // Notify calendar of selection changes
    if (this.calendar.options.onDateSelect) {
      this.calendar.options.onDateSelect(this.selectedDates);
    }
    
    // Update the calendar's internal selectedDates array
    this.calendar.selectedDates = [...this.selectedDates];
    
    // Trigger event on the container
    this.container.dispatchEvent(new CustomEvent('dateSelected', {
      detail: { dates: this.selectedDates }
    }));
  }
  
  /**
   * Toggle a date's selection state
   */
  toggleDate(date) {
    const dateStr = date.toDateString();
    const index = this.selectedDates.findIndex(d => d.toDateString() === dateStr);
    
    if (index !== -1) {
      // Remove date if already selected
      this.selectedDates.splice(index, 1);
    } else {
      // Add date if not selected
      this.selectedDates.push(date);
    }
  }
  
  /**
   * Select a range of dates (inclusive)
   */
  selectDateRange(startDate, endDate) {
    // Ensure startDate is before endDate
    if (startDate > endDate) {
      [startDate, endDate] = [endDate, startDate];
    }
    
    // Create array of dates in the range
    const dates = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    
    // Add range to selection (avoid duplicates)
    dates.forEach(date => {
      const dateStr = date.toDateString();
      const isAlreadySelected = this.selectedDates.some(d => d.toDateString() === dateStr);
      
      if (!isAlreadySelected) {
        this.selectedDates.push(date);
      }
    });
  }
  
  /**
   * Update the UI to reflect the current selection state
   */
  refresh() {
    // Clear all selections first
    const allDateElements = this.container.querySelectorAll('.calendar-day[data-date]');
    allDateElements.forEach(el => {
      el.classList.remove('selected');
    });
    
    // Apply selection styling
    this.selectedDates.forEach(date => {
      const dateStr = this.formatDateString(date);
      const dateEl = this.container.querySelector(`.calendar-day[data-date="${dateStr}"]`);
      
      if (dateEl) {
        dateEl.classList.add('selected');
      }
    });
  }
  
  /**
   * Format a date as YYYY-MM-DD string
   */
  formatDateString(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  /**
   * Static method to initialize a controller for a calendar
   */
  static initialize(calendar) {
    return new VerticalCalendarController(calendar);
  }
}

// Make the controller available globally
window.VerticalCalendarController = VerticalCalendarController; 