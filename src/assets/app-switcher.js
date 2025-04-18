/**
 * App Switcher
 * Handles switching between different views in a single-page application
 */
class AppSwitcher {
  /**
   * Initialize the app switcher
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.options = Object.assign({
      mainViewSelector: '#main-view',
      mbzViewSelector: '#mbz-creator-view',
      switchButtonSelector: '#app-mode-switch', // Button in the main header
      titleElementSelector: '#main-header .app-title', // Title element in the main header
      mainViewTitle: 'Booklet Generation Mode',
      mbzViewTitle: 'Moodle Batch Assignment Creation Mode'
    }, options);
    
    // Keep track of the current view
    this.currentView = 'main'; // 'main' or 'mbz'
    
    // Find elements
    this.mainView = document.querySelector(this.options.mainViewSelector);
    this.mbzView = document.querySelector(this.options.mbzViewSelector);
    this.switchButton = document.querySelector(this.options.switchButtonSelector);
    this.titleElement = document.querySelector(this.options.titleElementSelector);
    
    if (!this.mainView || !this.mbzView) {
      console.error('Could not find main or MBZ view elements.');
      return;
    }
    if (!this.titleElement) {
      console.error('Could not find title element.');
    }
    
    this.init();
  }
  
  /**
   * Initialize the app switcher
   */
  init() {
    // Set initial state
    this.showView(this.currentView);
    
    // Attach event listeners
    if (this.switchButton) {
      this.switchButton.addEventListener('click', () => {
        console.log('Switch button clicked! Current view:', this.currentView);
        this.toggleView();
      });
    } else {
      console.error('Switch button not found!');
    }
  }
  
  /**
   * Show a specific view
   * @param {string} viewName - 'main' or 'mbz'
   */
  showView(viewName) {
    // Update current view
    this.currentView = viewName;
    
    // Show/hide views
    if (viewName === 'main') {
      this.mainView.classList.add('active');
      this.mbzView.classList.remove('active');
      
      // Update title and body class
      document.body.classList.remove('mbz-mode');
      if (this.titleElement) {
        this.titleElement.textContent = this.options.mainViewTitle;
      }
      
      // Update switch button text and title
      if (this.switchButton) {
        this.switchButton.textContent = 'Go to Moodle Assignment Creation'; // Updated text
        this.switchButton.setAttribute('title', 'Switch to Moodle Batch Assignment Creation');
      }
    } else { // mbz view
      this.mainView.classList.remove('active');
      this.mbzView.classList.add('active');
      
      // Update title and body class
      document.body.classList.add('mbz-mode');
      if (this.titleElement) {
        this.titleElement.textContent = this.options.mbzViewTitle;
      }
      
      // Update switch button text and title
      if (this.switchButton) {
        this.switchButton.textContent = 'Go to Booklet Generation Mode'; // Updated text
        this.switchButton.setAttribute('title', 'Switch to Booklet Generation');
      }
    }
    
    // Trigger a custom event for other components to react
    window.dispatchEvent(new CustomEvent('viewChanged', { 
      detail: { view: viewName } 
    }));
  }
  
  /**
   * Toggle between views
   */
  toggleView() {
    const newView = this.currentView === 'main' ? 'mbz' : 'main';
    this.showView(newView);
  }
  
  /**
   * Switch to main view
   */
  showMainView() {
    this.showView('main');
  }
  
  /**
   * Switch to MBZ creator view
   */
  showMbzView() {
    this.showView('mbz');
  }
}

// Make the class available globally
window.AppSwitcher = AppSwitcher; 