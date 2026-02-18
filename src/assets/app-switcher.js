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
      mbzViewTitle: 'MBZ Modifier Mode'
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
      this.switchButton.addEventListener('click', () => this.toggleView());
    } else {
      console.error('Switch button not found!');
    }
  }
  
  /**
   * Show a specific view
   * @param {string} viewName - 'main' or 'mbz'
   */
  showView(viewName) {
    this.currentView = viewName;
    const isMain = viewName === 'main';

    this.mainView.classList.toggle('active', isMain);
    this.mbzView.classList.toggle('active', !isMain);
    document.body.classList.toggle('mbz-mode', !isMain);

    if (this.titleElement) {
      this.titleElement.textContent = isMain ? this.options.mainViewTitle : this.options.mbzViewTitle;
    }
    if (this.switchButton) {
      const targetLabel = isMain ? 'MBZ Modifier' : 'Booklet Generation Mode';
      this.switchButton.textContent = `Go to ${targetLabel}`;
      this.switchButton.setAttribute('title', `Switch to ${targetLabel}`);
    }

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
   * Switch to MBZ modifier view
   */
  showMbzView() {
    this.showView('mbz');
  }
}

// Make the class available globally
window.AppSwitcher = AppSwitcher; 