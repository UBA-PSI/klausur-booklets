/**
 * Calendar Selection Fix
 * Fixes issues with calendar date selection and display
 */

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize when in MBZ view or when the view changes to MBZ
  const initializeController = (mbzCreatorInstance) => {
    // Apply CSS once
    const styles = document.createElement('style');
    styles.textContent = `
      /* Custom selection styles */
      .calendar-day.direct-selected {
        background-color: #cfe2ff !important;
        color: #0d6efd !important;
        font-weight: bold !important;
        border: 2px solid #0d6efd !important;
        position: relative;
      }
      
      /* Add checkmark to selected days for clear visual feedback */
      .calendar-day.direct-selected::after {
        content: "✓";
        position: absolute;
        top: 1px;
        right: 3px;
        font-size: 10px;
        color: #0d6efd;
      }
      
      /* Animation for click feedback */
      @keyframes clickPulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.1); }
        100% { transform: scale(1); }
      }
      
      .calendar-day.click-pulse {
        animation: clickPulse 0.3s ease;
      }
      
      /* Always show the preview section */
      #selected-dates-preview-section { 
        display: block !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
    `;
    document.head.appendChild(styles);

    // The calendar controller with multi-selection support
    const ImprovedCalendarController = {
      selectedDates: [],
      calendarContainer: null, // Store reference to the container
      
      /**
       * Helper method to format a date as YYYY-MM-DD using UTC components
       * @param {Date} date - The date to format
       * @returns {string} Date string in YYYY-MM-DD format
       */
      formatDateString: function(date) {
        const year = date.getUTCFullYear();
        const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
        const day = date.getUTCDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
      },
      
      // Initialize once
      init: function() {
        // Find elements needed for preview updates
        this.namePrefixInput = document.getElementById('name-prefix-input');
        this.deadlineTimeInput = document.getElementById('deadlineTime');
        this.gracePeriodInput = document.getElementById('gracePeriod');
        this.previewTbody = document.getElementById('dates-tbody');
        this.previewSection = document.getElementById('selected-dates-preview-section');

        // Find the calendar container
        this.calendarContainer = document.getElementById('vertical-calendar-container');
        if (!this.calendarContainer) {
          console.error("Calendar container not found!");
          return false;
        }
        
        // Ensure the selected-dates-preview-section is visible
        if (this.previewSection) {
          this.previewSection.style.display = 'block';
          this.previewSection.classList.remove('hidden');
        }
        
        // Use delegation - attach one handler to the container
        this.calendarContainer.addEventListener('click', (e) => {
          // Check if our custom controller has already handled this event
          if (e.defaultPrevented) return;
          
          // Find the clicked day element
          const dayEl = e.target.closest('.calendar-day');
          // Only handle clicks on actual date elements, not disabled ones
          if (!dayEl || dayEl.classList.contains('other-month') || dayEl.classList.contains('past')) return;
          
          // Stop original handlers from firing
          e.stopPropagation();
          e.preventDefault();
          
          // Add visual feedback
          dayEl.classList.add('click-pulse');
          setTimeout(() => dayEl.classList.remove('click-pulse'), 300);
          
          // Get the date
          const dateStr = dayEl.getAttribute('data-date');
          if (!dateStr) return;
          
          // Parse YYYY-MM-DD string as UTC date
          const [year, month, day] = dateStr.split('-').map(Number);
          const date = new Date(Date.UTC(year, month - 1, day)); // month is 0-indexed
          
          // Toggle selection using our custom class
          if (dayEl.classList.contains('direct-selected')) {
            // Remove from selection
            dayEl.classList.remove('direct-selected');
            // Compare time values for robust filtering
            this.selectedDates = this.selectedDates.filter(d => 
              this.formatDateString(d) !== dateStr
            );
          } else {
            // Add to selection
            dayEl.classList.add('direct-selected');
            this.selectedDates.push(date);
          }
          
          // Sort dates
          this.selectedDates.sort((a, b) => a.getTime() - b.getTime());
          
          // Update the preview
          this.updatePreview();
        }, true); // Use capture phase

        // Add listener for when the calendar component finishes rendering
        this.calendarContainer.addEventListener('calendarRendered', () => {
          this.reapplyHighlights();
        });
               
        // Initial application of highlights and preview update
        this.reapplyHighlights();
        this.updatePreview();

        // Add listeners to update preview when inputs change
        this.namePrefixInput?.addEventListener('input', () => this.updatePreview());
        this.deadlineTimeInput?.addEventListener('input', () => this.updatePreview());
        this.gracePeriodInput?.addEventListener('change', () => this.updatePreview());

        return true;
      },
      
      // Re-apply the 'direct-selected' class to visible days based on selectedDates array
      reapplyHighlights: function() {
        if (!this.calendarContainer) return;

        // Clear existing highlights first
        this.calendarContainer.querySelectorAll('.calendar-day.direct-selected')
          .forEach(el => el.classList.remove('direct-selected'));

        // Apply highlights based on the stored selectedDates
        this.selectedDates.forEach(date => {
          // Use helper method for consistent formatting
          const dateStr = this.formatDateString(date);
          const dayEl = this.calendarContainer.querySelector(`.calendar-day[data-date="${dateStr}"]`);
          if (dayEl) {
            dayEl.classList.add('direct-selected');
          }
        });
      },
      
      // Update the preview table
      updatePreview: function() {
        // Check if necessary elements are available
        if (!this.previewTbody || !this.previewSection) {
          // Attempt to find them again if they weren't ready during init
          this.previewTbody = document.getElementById('dates-tbody');
          this.previewSection = document.getElementById('selected-dates-preview-section');
          if (!this.previewTbody || !this.previewSection) {
            console.error("Preview elements not found for update!");
            return;
          }
        }
        
        // Show/hide the section based on whether dates are selected
        if (this.selectedDates.length > 0) {
          this.previewSection.style.display = 'block';
          this.previewSection.classList.remove('hidden');
        } else {
          this.previewSection.style.display = 'none'; // Hide if no dates
          this.previewSection.classList.add('hidden');
        }
        
        // Clear the table
        this.previewTbody.innerHTML = '';
        
        // Skip the rest if no dates
        if (this.selectedDates.length === 0) {
          return;
        }
        
        // Get input values
        const namePrefix = document.getElementById('name-prefix-input')?.value || 'Assignment';
        
        // Parse the time from the new deadline time input
        const deadlineTimeInput = document.getElementById('deadlineTime');
        let hour = 17, minute = 0;
        
        if (deadlineTimeInput && deadlineTimeInput.value) {
          const timeParts = deadlineTimeInput.value.split(':');
          if (timeParts.length >= 2) {
            hour = parseInt(timeParts[0], 10);
            minute = parseInt(timeParts[1], 10);
          }
        }
        
        // Sort dates
        const sortedDates = [...this.selectedDates].sort((a, b) => a.getTime() - b.getTime());
        
        // Build the table
        sortedDates.forEach((date, index) => {
          // Get date parts using the helper method
          const [dueYear, dueMonth, dueDay] = this.formatDateString(date).split('-');
          const dueHour = hour.toString().padStart(2, '0');
          const dueMinute = minute.toString().padStart(2, '0');
          const dueSeconds = '00';
          const formattedDueDate = `${dueDay}/${dueMonth}/${dueYear}, ${dueHour}:${dueMinute}:${dueSeconds}`;
          
          // Set availability based on previous assignment's due date
          let availDate;
          let formattedAvailDate;
          if (index > 0) {
             availDate = new Date(sortedDates[index - 1]);
            // Calculate availability time based on previous due date (UTC)
            // Add 1 minute to the previous UTC due date/time
            const availTime = Date.UTC(availDate.getUTCFullYear(), availDate.getUTCMonth(), availDate.getUTCDate(), hour, minute, 0) + 60000;
            availDate = new Date(availTime);

            // Format Available Date using its UTC parts
            // Get date parts using the helper method
            const [availYear, availMonth, availDay] = this.formatDateString(availDate).split('-');
            const availHour = availDate.getUTCHours().toString().padStart(2, '0');
            const availMinute = availDate.getUTCMinutes().toString().padStart(2, '0');
            const availSeconds = availDate.getUTCSeconds().toString().padStart(2, '0');
            formattedAvailDate = `${availDay}/${availMonth}/${availYear}, ${availHour}:${availMinute}:${availSeconds}`;
           } else {
            // Default availability: today at 00:00:00 (local time is fine here as it's relative to 'now')
            const now = new Date();
            formattedAvailDate = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}, 00:00:00`;
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
        
        // Update the MbzBatchCreator instance directly
        if (mbzCreatorInstance) {
          mbzCreatorInstance.selectedDates = [...this.selectedDates];
          // Also update the generate button state via the instance method
          mbzCreatorInstance.updateGenerateButtonState(); 
        } else {
          console.warn('MbzBatchCreator instance not available to update selected dates.');
        }
      }
    };

    // Try to initialize, if it fails, retry after a delay
    const tryInitialize = (retryCount = 0) => {
      const initialized = ImprovedCalendarController.init();
      
      if (!initialized && retryCount < 5) {
        console.log(`Calendar initialization attempt ${retryCount + 1} failed, retrying in 500ms...`);
        setTimeout(() => tryInitialize(retryCount + 1), 500);
      } else if (initialized) {
        console.log('Calendar initialization successful');
        window.calendarController = ImprovedCalendarController;
      } else {
        console.error('Failed to initialize calendar controller after multiple attempts');
      }
    };
    
    // Start initialization attempts
    tryInitialize();
  };

  // Helper function to check if an element is visible
  const isElementVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  };

  // Check if we're already in MBZ view at initialization
  const checkInitialView = () => {
    const mbzView = document.getElementById('mbz-creator-view');
    if (mbzView && isElementVisible(mbzView)) {
      console.log('MBZ view is visible, initializing controller');
      // Wait for the calendar to be ready - longer timeout for initial load
      setTimeout(() => {
        // Attempt to get instance if initialized early
        const instance = document.getElementById('mbz-creator-view')?._mbzCreator;
        initializeController(instance);
      }, 1500); 
    }
  };

  // Initial check with a delay to ensure DOM is fully ready
  setTimeout(checkInitialView, 500);

  // Listen for view changes
  window.addEventListener('viewChanged', (event) => {
    if (event.detail.view === 'mbz') {
      console.log('View changed to MBZ, initializing controller');
      // Wait for the calendar to be ready
      setTimeout(() => {
        // Pass the instance when initializing on view change
        const instance = document.getElementById('mbz-creator-view')?._mbzCreator;
        initializeController(instance);
      }, 1500); 
    }
  });
}); 