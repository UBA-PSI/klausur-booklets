/**
 * MBZ Modifier Component
 * Loads an existing MBZ file, shows assignments for editing, and saves a modified MBZ.
 */

class MbzBatchCreator {
    constructor(container, options = {}) {
        this.container = container;
        if (!this.container) {
            throw new Error('MBZ Modifier container element not found.');
        }

        this.options = Object.assign({}, options);

        // Internal state
        this.mbzPath = null;
        this.assignments = []; // Array of { moduleId, name, duedate, cutoffdate, allowsubmissionsfromdate, dateStr, timeStr }
        this.activeAssignmentIndex = -1;
        this.elements = {};
        this.calendar = null;
        this.controller = null;
    }

    async buildUI() {
        try {
            const htmlContent = await window.electronAPI.loadMbzCreatorHtml();
            if (!htmlContent) {
                throw new Error('Received empty content for mbz_creator.html');
            }
            this.container.innerHTML = htmlContent;
        } catch (error) {
            console.error('Error building MBZ Modifier UI:', error);
            this.container.textContent = `Error loading MBZ Modifier UI: ${error.message}`;
        }
    }

    findElements() {
        this.elements = {
            selectMbzBtn: this.container.querySelector('#select-mbz-btn'),
            selectedFileLabel: this.container.querySelector('#selected-file-label'),
            assignmentListSection: this.container.querySelector('#assignment-list-section'),
            assignmentTbody: this.container.querySelector('#assignment-tbody'),
            timeSettingsSection: this.container.querySelector('#time-settings-section'),
            advancedSettingsSection: this.container.querySelector('#advanced-settings-section'),
            generateSection: this.container.querySelector('#generate-section'),
            deadlineTime: this.container.querySelector('#deadlineTime'),
            gracePeriod: this.container.querySelector('#gracePeriod'),
            applyTimeAllBtn: this.container.querySelector('#apply-time-all-btn'),
            targetStartDateInput: this.container.querySelector('#mbzTargetStartDate'),
            calendarContainer: this.container.querySelector('#vertical-calendar-container'),
            generateBtn: this.container.querySelector('#generate-btn'),
            statusMessage: this.container.querySelector('#status-message'),
        };
    }

    setupCollapse() {
        this.container.querySelectorAll('[data-bs-toggle="collapse"]').forEach(toggle => {
            const targetSelector = toggle.getAttribute('data-bs-target') || toggle.getAttribute('href');
            if (!targetSelector) return;
            const targetId = targetSelector.replace(/^#/, '');
            const targetElement = this.container.querySelector(`#${targetId}`) || document.getElementById(targetId);
            if (!targetElement) return;

            const chevronIcon = toggle.querySelector('.bi-chevron-down, .bi-chevron-up');

            toggle.addEventListener('click', (event) => {
                event.stopPropagation();
                const isExpanding = !targetElement.classList.contains('show');
                targetElement.classList.toggle('show');
                if (chevronIcon) {
                    chevronIcon.classList.toggle('bi-chevron-up', isExpanding);
                    chevronIcon.classList.toggle('bi-chevron-down', !isExpanding);
                }
            });
        });
    }

    initCalendar() {
        if (!this.elements.calendarContainer) return;

        this.calendar = new VerticalCalendar(this.elements.calendarContainer, {
            numMonths: 4,
            startDate: new Date(),
            weekStartsOn: 1,
            enablePastDates: false,
            scrollable: true,
        });

        this.elements.calendarContainer.addEventListener('calendarRendered', () => {
            if (this.controller) this.controller.refresh();
        });
    }

    attachEventListeners() {
        this.elements.selectMbzBtn?.addEventListener('click', () => this.selectAndParseMbz());
        this.elements.generateBtn?.addEventListener('click', () => this.generateModifiedMbz());
        this.elements.applyTimeAllBtn?.addEventListener('click', () => this.applyTimeToAll());

        this.elements.deadlineTime?.addEventListener('blur', () => {
            const timeValue = this.elements.deadlineTime.value;
            const timePattern = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/;
            if (!timePattern.test(timeValue)) {
                this.elements.deadlineTime.value = '17:00:00';
            } else if (timeValue.split(':').length === 2) {
                this.elements.deadlineTime.value = `${timeValue}:00`;
            }
        });

        this.container.querySelectorAll('.info-toggle').forEach(toggle => {
            toggle.addEventListener('click', (event) => {
                event.stopPropagation();
            });
        });
    }

    async selectAndParseMbz() {
        try {
            const result = await window.electronAPI.showOpenDialog({
                title: 'Select Moodle Backup (.mbz) File',
                properties: ['openFile'],
                filters: [{ name: 'Moodle Backup Files', extensions: ['mbz', 'gz'] }]
            });

            if (result.canceled || result.filePaths.length === 0) return;

            this.mbzPath = result.filePaths[0];
            const basename = await window.electronAPI.pathBasename(this.mbzPath);
            this.elements.selectedFileLabel.textContent = basename;
            this.elements.selectedFileLabel.title = this.mbzPath;

            this.setStatus('Parsing MBZ file...', 'info');
            this.elements.selectMbzBtn.disabled = true;

            const parseResult = await window.electronAPI.parseAssignmentsFromMbz(this.mbzPath);

            this.elements.selectMbzBtn.disabled = false;

            if (!parseResult.success) {
                this.setStatus(`Error: ${parseResult.message}`, 'error');
                return;
            }

            if (!parseResult.assignments || parseResult.assignments.length === 0) {
                this.setStatus('No assignments found in the MBZ file.', 'error');
                return;
            }

            // Enrich assignments with editable date/time strings
            this.assignments = parseResult.assignments.map(a => {
                if (a.duedate <= 0) {
                    return { ...a, dateStr: '', timeStr: '17:00:00' };
                }
                const d = new Date(a.duedate * 1000);
                const pad = (n) => String(n).padStart(2, '0');
                const dateStr = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
                const timeStr = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
                return { ...a, dateStr, timeStr };
            });

            this.activeAssignmentIndex = 0;
            this.renderAssignmentList();
            this.showSections();
            this.updateGenerateButtonState();
            this.setStatus(`Found ${this.assignments.length} assignment(s). Click a row, then click a calendar date to set its deadline.`, 'success');

            // Scroll calendar to the earliest assignment date
            this.scrollCalendarToFirstAssignment();

        } catch (error) {
            console.error('Error parsing MBZ:', error);
            this.setStatus(`Error: ${error.message}`, 'error');
            this.elements.selectMbzBtn.disabled = false;
        }
    }

    scrollCalendarToFirstAssignment() {
        const firstWithDate = this.assignments.find(a => a.dateStr);
        if (firstWithDate && this.calendar) {
            const [y, m] = firstWithDate.dateStr.split('-').map(Number);
            this.calendar.visibleStartDate = new Date(y, m - 1, 1);
            this.calendar.render();
            this.calendar.attachEventListeners();
        }
    }

    showSections() {
        const sections = ['assignmentListSection', 'timeSettingsSection', 'advancedSettingsSection', 'generateSection'];
        for (const key of sections) {
            if (this.elements[key]) this.elements[key].style.display = '';
        }
    }

    renderAssignmentList() {
        const tbody = this.elements.assignmentTbody;
        if (!tbody) return;

        tbody.replaceChildren();

        this.assignments.forEach((a, index) => {
            const row = document.createElement('tr');
            row.classList.add('assignment-row');
            if (index === this.activeAssignmentIndex) {
                row.classList.add('active');
            }

            // Index cell
            const idxCell = document.createElement('td');
            idxCell.classList.add('align-middle', 'text-center', 'fw-bold');
            idxCell.textContent = index + 1;
            row.appendChild(idxCell);

            // Name input cell
            const nameCell = document.createElement('td');
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.classList.add('form-control', 'form-control-sm', 'assignment-name-input');
            nameInput.value = a.name;
            nameInput.dataset.index = index;
            nameInput.dataset.field = 'name';
            nameCell.appendChild(nameInput);
            row.appendChild(nameCell);

            // Date input cell
            const dateCell = document.createElement('td');
            const dateInput = document.createElement('input');
            dateInput.type = 'date';
            dateInput.classList.add('form-control', 'form-control-sm');
            if (!a.dateStr) {
                dateInput.classList.add('assignment-date-input', 'unset');
            }
            dateInput.value = a.dateStr;
            dateInput.dataset.index = index;
            dateInput.dataset.field = 'dateStr';
            dateCell.appendChild(dateInput);
            row.appendChild(dateCell);

            // Time input cell
            const timeCell = document.createElement('td');
            const timeInput = document.createElement('input');
            timeInput.type = 'text';
            timeInput.classList.add('form-control', 'form-control-sm');
            timeInput.value = a.timeStr;
            timeInput.dataset.index = index;
            timeInput.dataset.field = 'timeStr';
            timeInput.placeholder = 'HH:MM:SS';
            timeCell.appendChild(timeInput);
            row.appendChild(timeCell);

            // Click row to activate (but not when clicking inside inputs)
            row.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT') return;
                this.setActiveAssignment(index);
            });

            // Focus on any input in the row also activates it
            row.querySelectorAll('input').forEach(input => {
                input.addEventListener('focus', () => {
                    this.setActiveAssignment(index);
                });
                input.addEventListener('change', (e) => {
                    const field = e.target.dataset.field;
                    const idx = parseInt(e.target.dataset.index, 10);
                    if (field === 'name') {
                        this.assignments[idx].name = e.target.value;
                    } else if (field === 'dateStr') {
                        this.assignments[idx].dateStr = e.target.value;
                        if (e.target.value) {
                            e.target.classList.remove('assignment-date-input', 'unset');
                        } else {
                            e.target.classList.add('assignment-date-input', 'unset');
                        }
                        this.updateCalendarHighlights();
                        this.updateGenerateButtonState();
                    } else if (field === 'timeStr') {
                        const timePattern = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/;
                        if (timePattern.test(e.target.value)) {
                            if (e.target.value.split(':').length === 2) {
                                e.target.value = `${e.target.value}:00`;
                            }
                            this.assignments[idx].timeStr = e.target.value;
                        } else {
                            e.target.value = this.assignments[idx].timeStr;
                        }
                    }
                });
            });

            tbody.appendChild(row);
        });

        this.updateCalendarHighlights();
    }

    setActiveAssignment(index) {
        this.activeAssignmentIndex = index;
        // Update row styling
        this.elements.assignmentTbody?.querySelectorAll('.assignment-row').forEach((row, i) => {
            row.classList.toggle('active', i === index);
        });
        // Notify controller
        if (this.controller) {
            this.controller.setActiveIndex(index);
        }
    }

    /**
     * Called by the calendar controller when a date is clicked.
     * Sets the active assignment's date.
     */
    onCalendarDateClicked(dateStr) {
        if (this.activeAssignmentIndex < 0 || this.activeAssignmentIndex >= this.assignments.length) return;

        this.assignments[this.activeAssignmentIndex].dateStr = dateStr;

        // Update the input field
        const dateInput = this.elements.assignmentTbody?.querySelector(
            `input[data-index="${this.activeAssignmentIndex}"][data-field="dateStr"]`
        );
        if (dateInput) {
            dateInput.value = dateStr;
            dateInput.classList.remove('assignment-date-input', 'unset');
        }

        // Auto-advance to next assignment
        if (this.activeAssignmentIndex < this.assignments.length - 1) {
            this.setActiveAssignment(this.activeAssignmentIndex + 1);

            // Scroll the newly active row into view
            const nextRow = this.elements.assignmentTbody?.querySelectorAll('.assignment-row')[this.activeAssignmentIndex];
            if (nextRow) {
                nextRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }

        this.updateCalendarHighlights();
        this.updateGenerateButtonState();
    }

    applyTimeToAll() {
        const time = this.elements.deadlineTime?.value || '17:00:00';
        // Validate
        const timePattern = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/;
        if (!timePattern.test(time)) return;

        const normalizedTime = time.split(':').length === 2 ? `${time}:00` : time;

        this.assignments.forEach((a) => {
            a.timeStr = normalizedTime;
        });

        // Update all time inputs
        this.elements.assignmentTbody?.querySelectorAll('input[data-field="timeStr"]').forEach(input => {
            input.value = normalizedTime;
        });
    }

    updateCalendarHighlights() {
        if (this.controller) {
            this.controller.reapplyHighlights();
        }
    }

    updateGenerateButtonState() {
        if (!this.elements.generateBtn) return;
        const allHaveDates = this.assignments.length > 0 &&
            this.assignments.every(a => a.dateStr);
        this.elements.generateBtn.disabled = !allHaveDates || !this.mbzPath;
    }

    setStatus(message, type = 'info') {
        if (this.elements.statusMessage) {
            this.elements.statusMessage.textContent = message;
            this.elements.statusMessage.className = `status-message ${type}`;
        }
    }

    async generateModifiedMbz() {
        if (!this.mbzPath || this.assignments.length === 0) return;

        const gracePeriodMinutes = parseInt(this.elements.gracePeriod?.value || '5', 10);

        // Build assignment data with timestamps
        const assignmentData = [];
        for (let i = 0; i < this.assignments.length; i++) {
            const a = this.assignments[i];
            const [year, month, day] = a.dateStr.split('-').map(Number);
            const timeParts = a.timeStr.split(':').map(Number);
            const hour = timeParts[0] || 0;
            const minute = timeParts[1] || 0;
            const second = timeParts[2] || 0;

            const dueDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
            const due_ts = Math.floor(dueDate.getTime() / 1000);
            const cutoff_ts = due_ts + gracePeriodMinutes * 60;

            let activation_ts;
            if (i === 0) {
                activation_ts = Math.floor(Date.now() / 1000);
            } else {
                activation_ts = assignmentData[i - 1].cutoff_ts;
            }

            assignmentData.push({
                moduleId: a.moduleId,
                name: a.name,
                due_ts,
                cutoff_ts,
                activation_ts,
            });
        }

        // Generate suggested filename
        const pad = (n) => String(n).padStart(2, '0');
        const now = new Date();
        const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const originalBasename = await window.electronAPI.pathBasename(this.mbzPath);
        const suggestedFilename = originalBasename.replace(/\.mbz$/i, '') + `-modified-${ts}.mbz`;

        const saveResult = await window.electronAPI.showSaveDialog({
            title: 'Save Modified MBZ File',
            defaultPath: suggestedFilename,
            filters: [{ name: 'Moodle Backup Files', extensions: ['mbz'] }]
        });

        if (saveResult.canceled || !saveResult.filePath) {
            this.setStatus('Save cancelled.', 'info');
            return;
        }

        try {
            this.setStatus('Generating modified MBZ...', 'info');
            this.elements.generateBtn.disabled = true;

            const targetStartDate = this.elements.targetStartDateInput?.value || null;
            let targetStartTimestamp = undefined;
            if (targetStartDate && /^\d{4}-\d{2}-\d{2}$/.test(targetStartDate)) {
                targetStartTimestamp = Math.floor(new Date(`${targetStartDate}T00:00:00Z`).getTime() / 1000);
            }

            const result = await window.electronAPI.modifyMbzAssignments({
                inputMbzPath: this.mbzPath,
                outputMbzPath: saveResult.filePath,
                assignments: assignmentData,
                targetStartTimestamp,
            });

            if (result.success) {
                this.setStatus(`Saved successfully: ${await window.electronAPI.pathBasename(saveResult.filePath)}`, 'success');
            } else {
                this.setStatus(`Error: ${result.message}`, 'error');
            }
        } catch (error) {
            console.error('Error generating MBZ:', error);
            this.setStatus(`Error: ${error.message}`, 'error');
        } finally {
            this.elements.generateBtn.disabled = false;
            this.updateGenerateButtonState();
        }
    }

    setController(controller) {
        this.controller = controller;
    }

    static initialize(container) {
        return new MbzBatchCreator(container);
    }
}

window.MbzBatchCreator = MbzBatchCreator;
