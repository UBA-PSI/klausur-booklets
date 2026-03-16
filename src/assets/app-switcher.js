/**
 * App Switcher
 * Handles switching between N views in a single-page application.
 * Main view shows navigation buttons; sub-views show a back button.
 */
class AppSwitcher {
    /**
     * Initialize the app switcher
     * @param {Object} options - Configuration options
     * @param {Array<{name: string, selector: string, title: string, buttonLabel: string, buttonIcon?: string}>} options.views
     * @param {string} options.buttonContainerSelector - Selector for the button container in the header
     * @param {string} options.titleElementSelector - Selector for the title element
     */
    constructor(options = {}) {
        this.options = Object.assign({
            views: [
                { name: 'main', selector: '#main-view', title: 'Booklet Generation Mode' },
                { name: 'mbz', selector: '#mbz-creator-view', title: 'MBZ Modifier Mode', buttonLabel: 'MBZ Modifier', buttonIcon: 'bi-arrow-repeat' },
                { name: 'ilias', selector: '#ilias-creator-view', title: 'ILIAS Exercise Creator', buttonLabel: 'ILIAS Exercise Creator', buttonIcon: 'bi-mortarboard' },
            ],
            buttonContainerSelector: '#app-mode-buttons',
            titleElementSelector: '#main-header .app-title',
        }, options);

        this.currentView = 'main';

        // Resolve view elements
        this.views = {};
        for (const v of this.options.views) {
            const el = document.querySelector(v.selector);
            if (!el) {
                console.error(`View element not found: ${v.selector}`);
            }
            this.views[v.name] = { ...v, element: el };
        }

        this.buttonContainer = document.querySelector(this.options.buttonContainerSelector);
        this.titleElement = document.querySelector(this.options.titleElementSelector);

        if (!this.buttonContainer) {
            console.error('Button container not found:', this.options.buttonContainerSelector);
        }

        this.init();
    }

    init() {
        this.showView(this.currentView);
    }

    /**
     * Render buttons appropriate for the current view.
     */
    renderButtons() {
        if (!this.buttonContainer) return;
        this.buttonContainer.replaceChildren();

        if (this.currentView === 'main') {
            // Show navigation buttons for each sub-view
            for (const v of this.options.views) {
                if (v.name === 'main' || !v.buttonLabel) continue;
                const btn = document.createElement('button');
                btn.className = 'btn btn-outline-primary app-switcher-btn';
                const icon = v.buttonIcon ? `<i class="${v.buttonIcon} me-1"></i>` : '';
                btn.innerHTML = `${icon}${v.buttonLabel}`;
                btn.title = `Switch to ${v.title}`;
                btn.addEventListener('click', () => this.showView(v.name));
                this.buttonContainer.appendChild(btn);
            }
        } else {
            // Show back button
            const btn = document.createElement('button');
            btn.className = 'btn btn-outline-secondary app-switcher-btn';
            btn.innerHTML = '<i class="bi bi-arrow-left me-1"></i>Back';
            btn.title = 'Back to main view';
            btn.addEventListener('click', () => this.showView('main'));
            this.buttonContainer.appendChild(btn);
        }
    }

    /**
     * Show a specific view
     * @param {string} viewName
     */
    showView(viewName) {
        this.currentView = viewName;

        // Toggle active class on all view containers
        for (const [name, v] of Object.entries(this.views)) {
            if (v.element) {
                v.element.classList.toggle('active', name === viewName);
            }
        }

        // Update body class for styling hooks
        document.body.classList.remove('mbz-mode', 'ilias-mode');
        if (viewName !== 'main') {
            document.body.classList.add(`${viewName}-mode`);
        }

        // Update title
        const viewConfig = this.views[viewName];
        if (this.titleElement && viewConfig) {
            this.titleElement.textContent = viewConfig.title;
        }

        // Render appropriate buttons
        this.renderButtons();

        // Dispatch event
        window.dispatchEvent(new CustomEvent('viewChanged', {
            detail: { view: viewName }
        }));
    }

    showMainView() {
        this.showView('main');
    }

    showMbzView() {
        this.showView('mbz');
    }

    showIliasView() {
        this.showView('ilias');
    }
}

window.AppSwitcher = AppSwitcher;
