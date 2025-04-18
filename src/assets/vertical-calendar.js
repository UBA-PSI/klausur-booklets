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
    
    // Create header with navigation controls
    const header = document.createElement('div');
    header.classList.add('calendar-header');
    header.innerHTML = `
      <div class="calendar-title">Calendar</div>
      <div class="calendar-nav">
        <button class="btn btn-sm btn-outline-secondary prev-month-btn">&laquo; Prev</button>
        <button class="btn btn-sm btn-outline-secondary next-month-btn">Next &raquo;</button>
      </div>
    `;
    this.container.appendChild(header);
    
    // Create the weekday header (Mon, Tue, etc.)
    const weekdayHeader = document.createElement('div');
    weekdayHeader.classList.add('weekday-header');
    
    // Create weekday labels based on start of week - Force Monday as first day
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    
    // Month label placeholder (left side)
    const monthLabelCol = document.createElement('div');
    monthLabelCol.classList.add('month-label-col');
    monthLabelCol.style.width = '30px';
    weekdayHeader.appendChild(monthLabelCol);
    
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
      calendarBody.style.height = 'calc(100% - 90px)'; // Adjust height based on header
    }
    this.container.appendChild(calendarBody);
    
    // Generate our dates for the visible months
    this.generateDates(calendarBody);
  }

  /**
   * Generate the date rows for the visible months
   */
  generateDates(calendarBody) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Start with the first visible month
    const startMonth = new Date(this.visibleStartDate);
    
    // Track the last date we rendered and its row
    let lastDate = null;
    let lastWeekEl = null;
    
    // Generate months
    for (let monthIndex = 0; monthIndex < this.options.numMonths; monthIndex++) {
      const currentMonth = new Date(startMonth);
      currentMonth.setMonth(startMonth.getMonth() + monthIndex);
      
      // Get the month name and year
      const monthName = currentMonth.toLocaleString('default', { month: 'long' });
      const year = currentMonth.getFullYear();
      
      // Create a month label element
      const monthLabel = document.createElement('div');
      monthLabel.classList.add('month-label');
      monthLabel.textContent = `${monthName.toUpperCase()} ${year}`;
      
      // Get the first day of the month
      const firstDayOfMonth = new Date(currentMonth);
      
      // Get the last day of the month
      const lastDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
      
      // If this is the first month or there's no last date from previous month,
      // calculate the first visible day of this month (might be from the previous month)
      let firstVisibleDay;
      let isFirstRow = true;
      
      if (monthIndex === 0 || !lastDate) {
        // Calculate the first visible day for the first month
        // Ensure we use Monday as week start (1)
        firstVisibleDay = new Date(firstDayOfMonth);
        const dayOfWeek = (firstDayOfMonth.getDay() || 7) - 1; // Convert 0-6 to 1-7 then adjust to 0-6 for Monday start
        firstVisibleDay.setDate(firstDayOfMonth.getDate() - dayOfWeek);
      } else {
        // Use the day after the last date from the previous month
        firstVisibleDay = new Date(lastDate);
        firstVisibleDay.setDate(lastDate.getDate() + 1);
        
        // If the first visible day is already the start of a week, use it
        // Otherwise, we're continuing in the last week of the previous month
        const dayOfWeek = firstVisibleDay.getDay() || 7; // Convert Sunday (0) to 7
        isFirstRow = dayOfWeek === 1; // Monday is 1
      }
      
      // Start with the first visible day
      let currentDate = new Date(firstVisibleDay);
      let currentWeekEl = lastWeekEl;
      
      // Generate weeks until we've reached beyond the last day of the month
      while (currentDate <= lastDayOfMonth) {
        // Check if we need to start a new week - Monday is 1, Sunday is 0
        const dayOfWeek = currentDate.getDay() || 7; // Convert Sunday (0) to 7
        if (isFirstRow || dayOfWeek === 1) { // Check if it's Monday (1)
          // Start a new week row
          currentWeekEl = document.createElement('div');
          currentWeekEl.classList.add('calendar-week');
          
          // Add the month label to the first row of a new month
          if (isFirstRow) {
            const labelCol = document.createElement('div');
            labelCol.classList.add('month-label-col');
            labelCol.appendChild(monthLabel);
            currentWeekEl.appendChild(labelCol);
            isFirstRow = false;
          } else {
            // Add an empty spacer for the month label column
            const spacer = document.createElement('div');
            spacer.classList.add('month-label-col');
            spacer.style.width = '30px';
            currentWeekEl.appendChild(spacer);
          }
          
          calendarBody.appendChild(currentWeekEl);
          lastWeekEl = currentWeekEl;
        }
        
        // Create day element
        const dayEl = document.createElement('div');
        dayEl.classList.add('calendar-day');
        
        // Add even/odd month styling for better visual distinction
        dayEl.classList.add(currentMonth.getMonth() % 2 === 0 ? 'even-month' : 'odd-month');
        
        // Check if this day is from current month
        const isCurrentMonth = currentDate.getMonth() === currentMonth.getMonth();
        
        // Check if this day is the first of the month
        const isFirstOfMonth = currentDate.getDate() === 1;
        if (isFirstOfMonth) {
          dayEl.classList.add('month-start');
        }
        
        // Check if this day is today
        const isToday = currentDate.toDateString() === today.toDateString();
        if (isToday) {
          dayEl.classList.add('today');
        }
        
        // Check if this date is selected
        const isSelected = this.selectedDates.some(d => 
          d.toDateString() === currentDate.toDateString());
        if (isSelected) {
          dayEl.classList.add('selected');
        }
        
        // Check if this date is in the past
        const isPast = currentDate < today && !isToday;
        if (isPast && !this.options.enablePastDates) {
          dayEl.classList.add('past');
        }
        
        // Set data attributes for selection
        dayEl.setAttribute('data-date', currentDate.toISOString());
        
        // Add the day number 
        dayEl.textContent = currentDate.getDate();
        
        // Add the day to the current week
        currentWeekEl.appendChild(dayEl);
        
        // Save this as the last date we processed
        lastDate = new Date(currentDate);
        
        // Move to the next day
        currentDate = new Date(currentDate);
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }
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
      const dayEl = this.container.querySelector(
        `.calendar-day[data-date="${current.toISOString()}"]`
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
      
      // Update UI if date is visible
      const dayEl = this.container.querySelector(
        `.calendar-day[data-date="${newDate.toISOString()}"]`
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
      const dateStr = date.toISOString();
      const dayEl = this.container.querySelector(`.calendar-day[data-date="${dateStr}"]`);
      if (dayEl) {
        dayEl.classList.add('selected');
      }
    });
  }
}

// Make the class available globally
window.VerticalCalendar = VerticalCalendar; 