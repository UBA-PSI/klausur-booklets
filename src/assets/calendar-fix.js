/**
 * Calendar Selection Fix
 * Fixes issues with calendar date selection and display
 */

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize when in MBZ view or when the view changes to MBZ
  const initializeController = () => {
    // Improved direct controller with event delegation
    console.log("Setting up improved calendar controller...");

    // One-time styles application
    const styles = document.createElement('style');
    styles.textContent = `
      /* Column widths */
      .mbz-creator-left { width: 60% !important; }
      .mbz-creator-right { width: 40% !important; }
      
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

    // The simplified controller with delegation
    const ImprovedCalendarController = {
      selectedDates: [],
      calendarContainer: null, // Store reference to the container
      
      // Initialize once
      init: function() {
        console.log("Initializing improved controller...");
        
        // Find elements needed for preview updates
        this.namePrefixInput = document.getElementById('name-prefix-input');
        this.hourSelect = document.getElementById('hour-select');
        this.minuteSelect = document.getElementById('minute-select');
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
          console.log("Direct click on ISO date:", dateStr);
          
          // Toggle selection using our custom class
          if (dayEl.classList.contains('direct-selected')) {
            // Remove from selection
            dayEl.classList.remove('direct-selected');
            // Compare time values for robust filtering
            const clickedDateKey = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
            this.selectedDates = this.selectedDates.filter(d => {
              const dateKey = `${d.getUTCFullYear()}-${(d.getUTCMonth()+1).toString().padStart(2, '0')}-${d.getUTCDate().toString().padStart(2, '0')}`;
              return dateKey !== clickedDateKey;
            });
          } else {
            // Add to selection
            dayEl.classList.add('direct-selected');
            this.selectedDates.push(date);
          }
          
          // Sort dates
          this.selectedDates.sort((a, b) => a.getTime() - b.getTime());
          
          // Update the preview
          this.updatePreview();
          
          // Find and update all other instances of this date (in case of scrolling)
          // No need to find other instances with delegation - the class is applied directly
        }, true); // Use capture phase

        // Add listener for when the calendar component finishes rendering
        this.calendarContainer.addEventListener('calendarRendered', () => {
          console.log('Calendar rendered, reapplying highlights...');
          this.reapplyHighlights();
        });
               
        // Initial application of highlights and preview update
        this.reapplyHighlights();
        this.updatePreview();

        // Add listeners to update preview when inputs change
        this.namePrefixInput?.addEventListener('input', () => this.updatePreview());
        this.hourSelect?.addEventListener('change', () => this.updatePreview());
        this.minuteSelect?.addEventListener('change', () => this.updatePreview());

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
          // Reconstruct YYYY-MM-DD from UTC components
          const year = date.getUTCFullYear();
          const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
          const day = date.getUTCDate().toString().padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;
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

        console.log(
          "Updating preview with", 
          this.selectedDates.length, 
          "dates:", 
          this.selectedDates.map(d => {
            const year = d.getUTCFullYear();
            const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
            const day = d.getUTCDate().toString().padStart(2, '0');
            return `${year}-${month}-${day}`;
          })
        );
        
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
        const namePrefix = this.namePrefixInput?.value || 'Assignment';
        const hour = parseInt(this.hourSelect?.value || '17', 10);
        const minute = parseInt(this.minuteSelect?.value || '0', 10);
        
        // Sort dates
        const sortedDates = [...this.selectedDates].sort((a, b) => a.getTime() - b.getTime());
        
        // Build the table
        sortedDates.forEach((date, index) => {
          // Format Due Date using UTC date parts and selected time
          const dueYear = date.getUTCFullYear();
          const dueMonth = (date.getUTCMonth() + 1).toString().padStart(2, '0');
          const dueDay = date.getUTCDate().toString().padStart(2, '0');
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
            const availYear = availDate.getUTCFullYear();
            const availMonth = (availDate.getUTCMonth() + 1).toString().padStart(2, '0');
            const availDay = availDate.getUTCDate().toString().padStart(2, '0');
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
        
        // Update generate button state if possible
        const generateBtn = document.getElementById('generate-btn');
        if (generateBtn) {
          const mbzCreator = document.getElementById('mbz-creator-view')?._mbzCreator;
          const mbzPath = mbzCreator?.mbzPath;
          generateBtn.disabled = !mbzPath || this.selectedDates.length === 0;
          
          // If we have access to the mbzCreator, also update its state
          if (mbzCreator) {
            mbzCreator.selectedDates = [...this.selectedDates];
          }
        }
      }
    };

    // Initialize and expose globally for debugging
    ImprovedCalendarController.init();
    window.calendarController = ImprovedCalendarController;

    console.log("Improved calendar controller ready!");
  };

  // Check if we're already in MBZ view at initialization
  if (document.getElementById('mbz-creator-view').style.display !== 'none') {
    // Wait for the calendar to be ready
    setTimeout(initializeController, 1000);
  }

  // Listen for view changes
  window.addEventListener('viewChanged', (event) => {
    if (event.detail.view === 'mbz') {
      // Wait for the calendar to be ready
      setTimeout(initializeController, 1000);
    }
  });
}); 