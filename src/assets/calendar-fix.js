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
      
      // Initialize once
      init: function() {
        console.log("Initializing improved controller...");
        
        // Find the calendar container
        const calendarContainer = document.getElementById('vertical-calendar-container');
        if (!calendarContainer) {
          console.error("Calendar container not found!");
          return false;
        }
        
        // Ensure the selected-dates-preview-section is visible
        const previewSection = document.getElementById('selected-dates-preview-section');
        if (previewSection) {
          previewSection.style.display = 'block';
          previewSection.classList.remove('hidden');
        }
        
        // Use delegation - attach one handler to the container
        calendarContainer.addEventListener('click', (e) => {
          // Find the clicked day element
          const dayEl = e.target.closest('.calendar-day');
          if (!dayEl) return;
          
          // Stop original handlers from firing
          e.stopPropagation();
          e.preventDefault();
          
          // Add visual feedback
          dayEl.classList.add('click-pulse');
          setTimeout(() => dayEl.classList.remove('click-pulse'), 300);
          
          // Get the date
          const dateStr = dayEl.getAttribute('data-date');
          if (!dateStr) return;
          
          const date = new Date(dateStr);
          console.log("Direct click on", date.toDateString());
          
          // Toggle selection using our custom class
          if (dayEl.classList.contains('direct-selected')) {
            // Remove from selection
            dayEl.classList.remove('direct-selected');
            this.selectedDates = this.selectedDates.filter(d => 
              d.toDateString() !== date.toDateString());
          } else {
            // Add to selection
            dayEl.classList.add('direct-selected');
            this.selectedDates.push(date);
          }
          
          // Sort dates
          this.selectedDates.sort((a, b) => a - b);
          
          // Update the preview
          this.updatePreview();
          
          // Find and update all other instances of this date (in case of scrolling)
          const allDateInstances = document.querySelectorAll(
            `.calendar-day[data-date="${dateStr}"]`
          );
          
          allDateInstances.forEach(el => {
            if (el !== dayEl) {
              if (dayEl.classList.contains('direct-selected')) {
                el.classList.add('direct-selected');
              } else {
                el.classList.remove('direct-selected');
              }
            }
          });
        }, true); // Use capture phase
        
        // Update the UI initially if there are already selected dates
        this.updatePreview();
        
        return true;
      },
      
      // Update the preview table
      updatePreview: function() {
        console.log("Updating preview with", this.selectedDates.length, "dates");
        
        // Find preview elements
        const previewSection = document.getElementById('selected-dates-preview-section');
        const previewTbody = document.getElementById('dates-tbody');
        
        if (!previewSection || !previewTbody) {
          console.error("Preview elements not found!");
          return;
        }
        
        // Always show the preview section
        previewSection.style.display = 'block';
        previewSection.classList.remove('hidden');
        
        // Clear the table
        previewTbody.innerHTML = '';
        
        // Skip the rest if no dates
        if (this.selectedDates.length === 0) {
          return;
        }
        
        // Get input values
        const namePrefix = document.getElementById('name-prefix-input')?.value || 'Assignment';
        const hour = parseInt(document.getElementById('hour-select')?.value || '17', 10);
        const minute = parseInt(document.getElementById('minute-select')?.value || '0', 10);
        
        // Sort dates
        const sortedDates = [...this.selectedDates].sort((a, b) => a.getTime() - b.getTime());
        
        // Build the table
        sortedDates.forEach((date, index) => {
          const dueDate = new Date(date);
          dueDate.setHours(hour, minute, 0, 0);
          
          // Set availability based on previous assignment's due date
          let availDate;
          if (index > 0) {
            availDate = new Date(sortedDates[index - 1]);
            availDate.setHours(hour, minute, 0, 0);
            availDate.setMinutes(availDate.getMinutes() + 1);
          } else {
            availDate = new Date();
            availDate.setHours(0, 0, 0, 0);
          }
          
          const row = document.createElement('tr');
          row.innerHTML = `
            <td>${index + 1}</td>
            <td>${namePrefix} ${index + 1}</td>
            <td>${dueDate.toLocaleString()}</td>
            <td>${availDate.toLocaleString()}</td>
          `;
          previewTbody.appendChild(row);
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