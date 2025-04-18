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
    // Find all date cells in the calendar
    const dateElements = this.calendar.container.querySelectorAll('.vc-date');
    
    // Remove existing click listeners and add our own
    dateElements.forEach(dateElement => {
      // Clone the element to remove all event listeners
      const newElement = dateElement.cloneNode(true);
      dateElement.parentNode.replaceChild(newElement, dateElement);
      
      // Add our custom click handler
      newElement.addEventListener('click', (event) => {
        this.handleDateClick(event, newElement);
      });
    });
  }

  /**
   * Handle date click with enhanced multi-selection
   * @param {MouseEvent} event - The mouse event
   * @param {HTMLElement} dateElement - The date element that was clicked
   */
  handleDateClick(event, dateElement) {
    // Get the date from the cell
    const dateStr = dateElement.dataset.date;
    if (!dateStr) return;
    
    const date = new Date(dateStr);
    
    // If neither ctrl nor shift is pressed, clear selection unless it's a toggle
    if (!this.isCtrlPressed && !this.isShiftPressed) {
      // Check if this date is already selected (for toggle behavior)
      const isSelected = dateElement.classList.contains('selected');
      
      // If not a toggle, clear all selections
      if (!isSelected) {
        this.calendar.selectedDates = [];
        this.calendar.container.querySelectorAll('.selected').forEach(el => {
          el.classList.remove('selected');
        });
      }
    }
    
    // Handle shift selection (range select)
    if (this.isShiftPressed && this.lastSelectedDate) {
      const start = new Date(Math.min(this.lastSelectedDate.getTime(), date.getTime()));
      const end = new Date(Math.max(this.lastSelectedDate.getTime(), date.getTime()));
      
      // Select all dates in the range
      this.calendar.container.querySelectorAll('.vc-date').forEach(el => {
        const cellDate = new Date(el.dataset.date);
        if (cellDate >= start && cellDate <= end) {
          el.classList.add('selected');
          this.addDateToSelection(cellDate);
        }
      });
    } else {
      // Toggle the selected state of the clicked date
      if (dateElement.classList.contains('selected')) {
        dateElement.classList.remove('selected');
        this.removeDateFromSelection(date);
      } else {
        dateElement.classList.add('selected');
        this.addDateToSelection(date);
      }
      
      // Update last selected date
      this.lastSelectedDate = date;
    }
    
    // Trigger the onDateSelect callback with updated selection
    if (this.calendar.options.onDateSelect) {
      this.calendar.options.onDateSelect(this.calendar.selectedDates);
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
    this.overrideCalendarClickHandler();
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