/**
 * Vertical Calendar Component
 * Displays a continuous calendar with months stacked vertically
 * with support for multi-date selection.
 */
class VerticalCalendar {
  /**
   * Initialize the vertical calendar
   * @param {HTMLElement} container - The container to render the calendar in
   * @param {Object} options - Configuration options
   */
  constructor(container, options = {}) {
    this.container = container;
    this.options = Object.assign({
      numMonths: 4,              // Number of months to display
      startDate: new Date(),     // Starting month to display
      selectedDates: [],         // Initially selected dates
      onDateSelect: null,        // Callback when date is selected
      weekStartsOn: 1,           // 0: Sunday, 1: Monday, ..., 6: Saturday
      minDate: null,             // Minimum selectable date (null = no limit)
      enablePastDates: false,    // Whether past dates can be selected
      allowRangeSelect: false,   // Allow selecting ranges of dates by dragging
      scrollable: true,          // Whether the calendar should scroll or fit
    }, options);

    // Store internal state
    this.visibleStartDate = new Date(this.options.startDate);
    this.visibleStartDate.setDate(1); // Set to first of the month
    this.selectedDates = [...this.options.selectedDates];
    this.isSelecting = false;    // For drag selection
    this.selectionStart = null;  // For drag selection

    // Normalize start date to first day of the month
    this.visibleStartDate.setHours(0, 0, 0, 0);
    
    // Initialize the calendar
    this.init();
  }

  /**
   * Initialize the calendar structure and attach event listeners
   */
  init() {
    this.render();
    this.attachEventListeners();
  }

  /**
   * Render the calendar in the container
   */
  render() {
    if (!this.container) return;
    
    // Set up a container for our calendar
    this.container.innerHTML = '';
    this.container.classList.add('vertical-calendar');

    // Inject necessary styles
    this.injectStyles();
    
    // Create header with navigation controls
    const header = document.createElement('div');
    header.classList.add('calendar-header');
    header.innerHTML = `
      <button class="btn btn-sm btn-outline-secondary prev-month-btn">&laquo; Prev</button>
      <div class="calendar-title">${this.visibleStartDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</div>
      <button class="btn btn-sm btn-outline-secondary next-month-btn\">Next &raquo;</button>
    `;
    this.container.appendChild(header);
    
    // Create the weekday header (Mon, Tue, etc.)
    const weekdayHeader = document.createElement('div');
    weekdayHeader.classList.add('weekday-header');
    
    // Create weekday labels based on start of week - Force Monday as first day
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        
    // Weekday labels
    weekdays.forEach(day => {
      const dayEl = document.createElement('div');
      dayEl.classList.add('weekday-label');
      dayEl.textContent = day;
      weekdayHeader.appendChild(dayEl);
    });
    
    this.container.appendChild(weekdayHeader);
    
    // Calendar body - will contain our weeks
    const calendarBody = document.createElement('div');
    calendarBody.classList.add('calendar-body');
    if (this.options.scrollable) {
      calendarBody.style.overflowY = 'auto';
      calendarBody.style.height = 'calc(100% - 90px)'; // Adjust height based on header and weekday header
    }
    this.container.appendChild(calendarBody);
    
    // Generate our dates for the visible months
    this.generateDates(calendarBody);

    // Notify that rendering is complete
    this.container.dispatchEvent(new CustomEvent('calendarRendered'));
  }

  /**
   * Inject CSS styles for the calendar
   */
  injectStyles() {
    const styleId = 'vertical-calendar-styles';
    if (document.getElementById(styleId)) return; // Inject only once

    const styles = document.createElement('style');
    styles.id = styleId;
    styles.textContent = `
      .vertical-calendar .calendar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 5px 10px;
        border-bottom: 1px solid #eee;
      }
      .vertical-calendar .calendar-title {
        font-weight: bold;
      }
      .vertical-calendar .weekday-header {
        display: flex;
        justify-content: space-around;
        background-color: #f8f9fa;
        border-bottom: 1px solid #eee;
        padding: 5px 0;
      }
      .vertical-calendar .weekday-label {
        flex: 1;
        text-align: center;
        font-size: 0.8em;
        font-weight: bold;
        color: #6c757d;
      }
      .vertical-calendar .calendar-week {
        display: flex;
        justify-content: space-around;
        border-bottom: 1px solid #f1f1f1;
      }
      .vertical-calendar .calendar-day {
        flex: 1;
        text-align: center;
        padding: 8px 0;
        cursor: pointer;
        position: relative;
        border-right: 1px solid #f1f1f1;
        min-height: 38px; /* Ensure consistent height */
        display: flex; /* Use flex for centering */
        justify-content: center; /* Center horizontally */
        align-items: center; /* Center vertically */
        font-size: 0.9em;
      }
      .vertical-calendar .calendar-day:last-child {
        border-right: none;
      }
      .vertical-calendar .calendar-day.other-month {
        color: #ccc;
        cursor: default;
      }
      .vertical-calendar .calendar-day.past {
        color: #aaa;
        cursor: default;
        background-color: #f9f9f9;
      }
      .vertical-calendar .calendar-day.today {
        font-weight: bold;
        background-color: #fffacd; /* Light yellow */
      }
      .vertical-calendar .calendar-day.selected {
        /* Basic selection style, overridden by calendar-fix.js */
        background-color: #e0e0e0; 
      }
       .vertical-calendar .calendar-day.first-day-of-month {
        /* Styles for the 1st day of the month */
        display: flex;
        flex-direction: column;
        justify-content: center; /* Vertical center */
        align-items: center;     /* Horizontal center */
        line-height: 1;       /* Adjust line height */
        padding-top: 4px;      
        padding-bottom: 4px;
        font-weight: bold; /* Make the day number bold */
      }
      .vertical-calendar .calendar-day.first-day-of-month .month-abbr {
        font-size: 0.6em;      /* Smaller font for month */
        font-weight: normal; /* Normal weight for abbr */
        display: block;         /* Ensure it takes its own line */
        margin-top: 1px;       
        color: #555; /* Slightly muted color */
      }
      .vertical-calendar .calendar-day.even-month { background-color: #ffffff; }
      .vertical-calendar .calendar-day.odd-month { background-color: #fdfdfd; }
      .vertical-calendar .calendar-day.even-month.past { background-color: #f9f9f9; }
      .vertical-calendar .calendar-day.odd-month.past { background-color: #f7f7f7; }

    `;
    document.head.appendChild(styles);
  }

  /**
   * Generate the date rows for the visible months
   */
  generateDates(calendarBody) {
    calendarBody.innerHTML = ''; // Clear previous dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Start with the first visible month
    const startMonthDate = new Date(this.visibleStartDate);
    
    // Update header title
    const titleEl = this.container.querySelector('.calendar-title');
    if (titleEl) {
      titleEl.textContent = startMonthDate.toLocaleString('default', { month: 'long', year: 'numeric' });
    }

    // Calculate the first day to display (start of the week containing the 1st)
    const firstOfMonth = new Date(startMonthDate.getFullYear(), startMonthDate.getMonth(), 1);
    const dayOfWeek = (firstOfMonth.getDay() + 6) % 7; // 0=Mon, 1=Tue, ..., 6=Sun
    const firstVisibleDay = new Date(firstOfMonth);
    firstVisibleDay.setDate(firstOfMonth.getDate() - dayOfWeek);

    // Calculate the last day to display (end of the week containing the last day of the month)
    const lastOfMonth = new Date(startMonthDate.getFullYear(), startMonthDate.getMonth() + this.options.numMonths, 0);
    const lastDayOfWeek = (lastOfMonth.getDay() + 6) % 7;
    const lastVisibleDay = new Date(lastOfMonth);
    lastVisibleDay.setDate(lastOfMonth.getDate() + (6 - lastDayOfWeek));

    let currentDate = new Date(firstVisibleDay);
    let currentWeekEl = null;

    while (currentDate <= lastVisibleDay) {
        const dayIndex = (currentDate.getDay() + 6) % 7; // 0=Mon

        // Start a new week if it's Monday
        if (dayIndex === 0) {
            currentWeekEl = document.createElement('div');
            currentWeekEl.classList.add('calendar-week');
            calendarBody.appendChild(currentWeekEl);
        }

        // Create day element using a helper function
        const dayEl = this._renderDay(currentDate, startMonthDate.getMonth(), startMonthDate.getFullYear(), today);
        currentWeekEl.appendChild(dayEl);

        // Move to the next day
        currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  /**
   * Render a single day element
   * @param {Date} date - The date to render
   * @param {number} displayStartMonth - The starting month index being displayed (0-11)
   * @param {number} displayStartYear - The starting year being displayed
   * @param {Date} today - Today's date (for styling)
   * @returns {HTMLElement} The created day element
   */
  _renderDay(date, displayStartMonth, displayStartYear, today) {
      const dayEl = document.createElement('div');
      dayEl.classList.add('calendar-day');

      const currentMonth = date.getMonth();
      const displayEndMonth = (displayStartMonth + this.options.numMonths - 1) % 12;
      const displayEndYear = displayStartYear + Math.floor((displayStartMonth + this.options.numMonths - 1) / 12);

      // Determine if the date is outside the visible month range
      const isOutsideVisibleRange = date.getFullYear() < displayStartYear || 
                                   (date.getFullYear() === displayStartYear && currentMonth < displayStartMonth) ||
                                   date.getFullYear() > displayEndYear ||
                                   (date.getFullYear() === displayEndYear && currentMonth > displayEndMonth);


      if (isOutsideVisibleRange) {
          dayEl.classList.add('other-month');
          dayEl.innerHTML = `<span>${date.getDate()}</span>`; // Render day number but style as inactive
      } else {
          // Create ISO date string (YYYY-MM-DD) from local date components
          // This ensures the date-attribute matches the visually displayed date
          const year = date.getFullYear();
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const day = date.getDate().toString().padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;
          dayEl.setAttribute('data-date', dateStr);
          
          // Debug output to verify the date matches the visual display
          console.debug(`Rendering ${date.getDate()} ${date.toLocaleString('default', { month: 'short' })} as data-date="${dateStr}"`);

          // Add even/odd month styling
          dayEl.classList.add(currentMonth % 2 === 0 ? 'even-month' : 'odd-month');

          // Check if this day is the first of the month
          if (date.getDate() === 1) {
              dayEl.classList.add('first-day-of-month');
              const monthAbbr = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
              dayEl.innerHTML = `<span>${date.getDate()}</span><small class="month-abbr">${monthAbbr}</small>`;
          } else {
              dayEl.innerHTML = `<span>${date.getDate()}</span>`;
          }

          // Check if this day is today
          if (date.toDateString() === today.toDateString()) {
              dayEl.classList.add('today');
          }

          // Check if this date is in the past (and not today)
          const isPast = date < today;
          if (isPast && !this.options.enablePastDates) {
              dayEl.classList.add('past');
          }

          // Check if selected (initial render - calendar-fix will handle dynamic selection)
          const isSelected = this.selectedDates.some(d => d.toDateString() === date.toDateString());
          if (isSelected) {
              dayEl.classList.add('selected'); // Basic highlight, calendar-fix overrides
          }
      }
      return dayEl;
  }

  /**
   * Attach event listeners to the calendar elements
   */
  attachEventListeners() {
    // Prev/Next month buttons
    const prevBtn = this.container.querySelector('.prev-month-btn');
    const nextBtn = this.container.querySelector('.next-month-btn');
    
    if (prevBtn) {
      prevBtn.addEventListener('click', () => this.prevMonth());
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.nextMonth());
    }
    
    // Date click and drag handlers
    const calendarBody = this.container.querySelector('.calendar-body');
    if (!calendarBody) return;
    
    // Click to select date
    calendarBody.addEventListener('click', (e) => {
      const dayEl = e.target.closest('.calendar-day');
      if (!dayEl) return;
      
      // Skip past dates if not enabled
      if (dayEl.classList.contains('past') && !this.options.enablePastDates) {
        return;
      }
      
      const dateStr = dayEl.getAttribute('data-date');
      if (dateStr) {
        const clickedDate = new Date(dateStr);
        this.toggleDateSelection(clickedDate, dayEl);
        
        // Ensure the callback is called after toggling
        if (this.options.onDateSelect) {
          this.options.onDateSelect([...this.selectedDates]);
        }
      }
    });
    
    // For drag selection - mousedown to start
    if (this.options.allowRangeSelect) {
      calendarBody.addEventListener('mousedown', (e) => {
        const dayEl = e.target.closest('.calendar-day');
        if (!dayEl) return;
        
        // Skip past dates if not enabled
        if (dayEl.classList.contains('past') && !this.options.enablePastDates) {
          return;
        }
        
        // Start drag selection
        this.isSelecting = true;
        const dateStr = dayEl.getAttribute('data-date');
        if (dateStr) {
          this.selectionStart = new Date(dateStr);
          
          // Clear previous selection if not holding shift
          if (!e.shiftKey) {
            this.selectedDates = [];
            // Update the UI to clear previous selections
            this.container.querySelectorAll('.calendar-day.selected').forEach(el => {
              el.classList.remove('selected');
            });
          }
          
          // Add this date to selection
          this.toggleDateSelection(this.selectionStart, dayEl);
        }
        
        // Prevent text selection during drag
        e.preventDefault();
      });
      
      // Drag over days
      calendarBody.addEventListener('mouseover', (e) => {
        if (!this.isSelecting) return;
        
        const dayEl = e.target.closest('.calendar-day');
        if (!dayEl) return;
        
        // Skip past dates if not enabled
        if (dayEl.classList.contains('past') && !this.options.enablePastDates) {
          return;
        }
        
        const dateStr = dayEl.getAttribute('data-date');
        if (dateStr) {
          const hoverDate = new Date(dateStr);
          
          // Select all dates between start and hover
          this.selectDateRange(this.selectionStart, hoverDate);
        }
      });
      
      // End drag selection
      document.addEventListener('mouseup', (e) => {
        if (this.isSelecting) {
          // Ensure we call the callback with the final selection
          if (this.options.onDateSelect) {
            this.options.onDateSelect([...this.selectedDates]);
          }
          this.isSelecting = false;
        }
      });
    }
  }

  /**
   * Toggle the selection state of a date
   */
  toggleDateSelection(date, element) {
    // Find if this date is already selected
    const index = this.selectedDates.findIndex(d => 
      d.toDateString() === date.toDateString());
    
    if (index >= 0) {
      // Date is already selected, remove it
      this.selectedDates.splice(index, 1);
      element?.classList.remove('selected');
    } else {
      // Date is not selected, add it
      this.selectedDates.push(new Date(date));
      element?.classList.add('selected');
    }
    
    // Sort selected dates chronologically
    this.selectedDates.sort((a, b) => a - b);
  }

  /**
   * Select a range of dates (inclusive)
   */
  selectDateRange(start, end) {
    // Ensure start is before end
    if (start > end) {
      [start, end] = [end, start];
    }
    
    // Clear current selection
    this.selectedDates = [];
    this.container.querySelectorAll('.calendar-day.selected').forEach(el => {
      el.classList.remove('selected');
    });
    
    // Add all dates in the range
    const current = new Date(start);
    const endTime = end.getTime();
    
    while (current.getTime() <= endTime) {
      // Format the date consistently with _renderDay
      const year = current.getFullYear();
      const month = (current.getMonth() + 1).toString().padStart(2, '0');
      const day = current.getDate().toString().padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      const dayEl = this.container.querySelector(
        `.calendar-day[data-date="${dateStr}"]`
      );
      
      // Skip past dates if not enabled
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isPast = current < today;
      
      if ((!isPast || this.options.enablePastDates) && dayEl) {
        this.selectedDates.push(new Date(current));
        dayEl.classList.add('selected');
      }
      
      // Move to next day
      current.setDate(current.getDate() + 1);
    }
    
    // Call the selection callback if provided
    if (this.options.onDateSelect) {
      this.options.onDateSelect([...this.selectedDates]);
    }
  }

  /**
   * Get all currently selected dates
   */
  getSelectedDates() {
    return [...this.selectedDates];
  }

  /**
   * Set selected dates programmatically
   */
  setSelectedDates(dates) {
    // Clear current selection
    this.selectedDates = [];
    this.container.querySelectorAll('.calendar-day.selected').forEach(el => {
      el.classList.remove('selected');
    });
    
    // Add each date to selection
    dates.forEach(date => {
      const newDate = new Date(date);
      this.selectedDates.push(newDate);
      
      // Format date consistently
      const year = newDate.getFullYear();
      const month = (newDate.getMonth() + 1).toString().padStart(2, '0');
      const day = newDate.getDate().toString().padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      const dayEl = this.container.querySelector(
        `.calendar-day[data-date="${dateStr}"]`
      );
      if (dayEl) {
        dayEl.classList.add('selected');
      }
    });
    
    // Sort selected dates chronologically
    this.selectedDates.sort((a, b) => a - b);
  }

  /**
   * Move to previous month
   */
  prevMonth() {
    this.visibleStartDate.setMonth(this.visibleStartDate.getMonth() - 1);
    // Create a new date object to trigger a re-render
    this.visibleStartDate = new Date(this.visibleStartDate);
    this.render();
    this.attachEventListeners(); // Important: reattach listeners after re-rendering
    
    // Update the UI to show the selected dates
    this.updateSelectedDatesUI();
  }

  /**
   * Move to next month
   */
  nextMonth() {
    this.visibleStartDate.setMonth(this.visibleStartDate.getMonth() + 1);
    // Create a new date object to trigger a re-render
    this.visibleStartDate = new Date(this.visibleStartDate);
    this.render();
    this.attachEventListeners(); // Important: reattach listeners after re-rendering
    
    // Update the UI to show the selected dates
    this.updateSelectedDatesUI();
  }
  
  /**
   * Update the UI to show the selected dates
   */
  updateSelectedDatesUI() {
    // Find all day elements corresponding to selected dates and mark them
    this.selectedDates.forEach(date => {
      // Format date consistently
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      const dayEl = this.container.querySelector(`.calendar-day[data-date="${dateStr}"]`);
      if (dayEl) {
        dayEl.classList.add('selected');
      }
    });
  }
}

// Make the class available globally
window.VerticalCalendar = VerticalCalendar; 