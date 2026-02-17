/**
 * Vertical Calendar Controller
 * Manages calendar interaction for the MBZ Modifier.
 * Click = set active assignment's date. Highlights show assigned dates with index numbers.
 */
class VerticalCalendarController {
    /**
     * @param {VerticalCalendar} calendar - The vertical calendar instance
     * @param {MbzBatchCreator} mbzInstance - The MBZ Modifier instance
     */
    constructor(calendar, mbzInstance) {
        this.calendar = calendar;
        this.mbzCreator = mbzInstance;
        this.activeIndex = 0;
        this.clickHandler = null;

        this.init();
    }

    init() {
        this.injectStyles();
        this.attachDelegatedClickHandler();

        this.calendar.container.addEventListener('calendarRendered', () => {
            this.reapplyHighlights();
        });

        this.reapplyHighlights();
    }

    injectStyles() {
        const styleId = 'vertical-calendar-controller-styles';
        if (document.getElementById(styleId)) return;

        const styles = document.createElement('style');
        styles.id = styleId;
        styles.textContent = `
            .calendar-day.assigned-date {
                background-color: #cfe2ff !important;
                color: #0d6efd !important;
                font-weight: bold !important;
                position: relative;
                border: 1px solid #a6c8ff !important;
                box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.1);
            }

            .calendar-day.assigned-date.active-assignment {
                background-color: #0d6efd !important;
                color: #fff !important;
                border-color: #0a58ca !important;
                box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.2);
            }

            .calendar-day.assigned-date::after {
                content: attr(data-assignment-index);
                position: absolute;
                top: 1px;
                right: 2px;
                font-size: 9px;
                color: #0a58ca;
                font-weight: bold;
                padding: 0 2px;
                line-height: 1;
                text-align: center;
                background-color: rgba(255, 255, 255, 0.6);
                border-radius: 2px;
                white-space: nowrap;
            }

            .calendar-day.assigned-date.active-assignment::after {
                color: #fff;
                background-color: rgba(0, 0, 0, 0.2);
            }

            @keyframes clickPulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); }
            }

            .calendar-day.click-pulse {
                animation: clickPulse 0.3s ease-out;
            }
        `;
        document.head.appendChild(styles);
    }

    attachDelegatedClickHandler() {
        if (this.clickHandler) {
            this.calendar.container.removeEventListener('click', this.clickHandler, true);
        }

        this.clickHandler = (event) => {
            const dateElement = event.target.closest('.calendar-day');
            if (!dateElement) return;

            event.preventDefault();
            event.stopPropagation();

            if (dateElement.classList.contains('other-month') || dateElement.classList.contains('past')) {
                return;
            }

            dateElement.classList.add('click-pulse');
            setTimeout(() => dateElement.classList.remove('click-pulse'), 300);

            const dateStr = dateElement.dataset.date;
            if (!dateStr) return;

            this.mbzCreator?.onCalendarDateClicked(dateStr);
        };

        this.calendar.container.addEventListener('click', this.clickHandler, true);
    }

    /**
     * Set the active assignment index (called from MbzBatchCreator)
     */
    setActiveIndex(index) {
        this.activeIndex = index;
        this.reapplyHighlights();
    }

    refresh() {
        this.attachDelegatedClickHandler();
        this.reapplyHighlights();
    }

    /**
     * Reapply highlights based on the MBZ Modifier's assignment data
     */
    reapplyHighlights() {
        if (!this.calendar || !this.calendar.container || !this.mbzCreator) return;

        // Clear existing highlights
        this.calendar.container.querySelectorAll('.calendar-day.assigned-date').forEach(el => {
            el.classList.remove('assigned-date', 'active-assignment');
            delete el.dataset.assignmentIndex;
        });

        const assignments = this.mbzCreator.assignments || [];
        const activeIdx = this.mbzCreator.activeAssignmentIndex;

        // Collect assignment indices per date
        const dateMap = new Map(); // dateStr -> { indices: number[], hasActive: bool }
        assignments.forEach((a, index) => {
            if (!a.dateStr) return;
            let entry = dateMap.get(a.dateStr);
            if (!entry) {
                entry = { indices: [], hasActive: false };
                dateMap.set(a.dateStr, entry);
            }
            entry.indices.push(index + 1);
            if (index === activeIdx) entry.hasActive = true;
        });

        for (const [dateStr, { indices, hasActive }] of dateMap) {
            const dayEl = this.calendar.container.querySelector(`.calendar-day[data-date="${dateStr}"]`);
            if (dayEl && !dayEl.classList.contains('other-month') && !dayEl.classList.contains('past')) {
                dayEl.classList.add('assigned-date');
                dayEl.dataset.assignmentIndex = indices.join(', ');
                if (hasActive) {
                    dayEl.classList.add('active-assignment');
                }
            }
        }
    }

    static initialize(calendar, mbzInstance) {
        if (!calendar?.container) {
            console.error('Calendar instance or container not provided.');
            return null;
        }
        if (!mbzInstance) {
            console.warn('MbzBatchCreator instance not provided.');
        }
        return new VerticalCalendarController(calendar, mbzInstance);
    }
}

window.VerticalCalendarController = VerticalCalendarController;
