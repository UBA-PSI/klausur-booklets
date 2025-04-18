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
    this.selectedDates = [...this.options.selectedDates]; // Keep for initial render check

    // Normalize start date to first day of the month
    this.visibleStartDate.setHours(0, 0, 0, 0);
    
    // Initialize the calendar
    this.init();
  }

  /**
   * Format a date as YYYY-MM-DD string using local date components
   * @param {Date} date - The date to format
   * @returns {string} A date string in YYYY-MM-DD format
   */
  formatDateString(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
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
        /* Selection styling is now handled by calendar-fix.js */
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
    //document.head.appendChild(styles);
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
          const dateStr = this.formatDateString(date);
          dayEl.setAttribute('data-date', dateStr);

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
              // Add a base class, actual styling by calendar-fix.js
              dayEl.classList.add('selected-base'); 
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
  }
}

// Make the class available globally
window.VerticalCalendar = VerticalCalendar; 