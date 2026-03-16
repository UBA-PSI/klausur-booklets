/**
 * ILIAS Exercise Creator Component
 * Creates ILIAS exercise export ZIPs with configurable assignment units.
 *
 * UX: Click calendar dates to toggle assignments (add/remove).
 * Two modes: "start dates" (click lecture days, deadline auto-computed)
 * or "deadline dates" (click deadlines, start auto-computed).
 *
 * Duck-types the same calendar interface as MbzBatchCreator for
 * VerticalCalendarController compatibility (.assignments, .activeAssignmentIndex,
 * .onCalendarDateClicked(), .setController()).
 */
/* global VerticalCalendar */

const ILIAS_TIME_PATTERN = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/;

const ILIAS_INSTRUCTION_TEMPLATES = {
    de:
        '<p>Laden Sie eine Datei hoch (PDF bevorzugt, JPG/PNG geht auch).<br>\n' +
        'Achtung: Nur die erste Seite einer PDF-Datei wird verwendet.<br>\n' +
        'Sie k\u00f6nnen die Datei jederzeit vor Ablauf der jeweiligen Frist ersetzen.</p>\n' +
        '\n' +
        '<p><b>Checkliste f\u00fcr Bildqualit\u00e4t</b></p>\n' +
        '\n' +
        '<ul>\n' +
        '    <li>Scannen/fotografieren Sie bei gutem Licht, ohne Schatten.</li>\n' +
        '    <li>Schneiden Sie Fotos zu und drehen Sie diese, damit der Text aufrecht steht, z.&nbsp;B. mit beliebten Scanner-Apps wie Microsoft Lens, Adobe Scan oder Genius Scan.</li>\n' +
        '    <li>Streben Sie 300&nbsp;dpi bei A5 (etwa 1770&nbsp;\u00d7&nbsp;2480 Pixel) an.</li>\n' +
        '    <li>Zoomen Sie auf 100&nbsp;% und pr\u00fcfen Sie die Lesbarkeit vor dem Hochladen.</li>\n' +
        '    <li>Achten Sie darauf, dass Ihr Text auch in A5 noch gut lesbar ist.</li>\n' +
        '</ul>',
    en:
        '<p>Upload a file (PDF preferred, JPG/PNG also accepted).<br>\n' +
        'Note: Only the first page of a PDF file will be used.<br>\n' +
        'You may replace your file at any time before the respective deadline.</p>\n' +
        '\n' +
        '<p><b>Image quality checklist</b></p>\n' +
        '\n' +
        '<ul>\n' +
        '    <li>Scan or photograph in good lighting, without shadows.</li>\n' +
        '    <li>Crop and rotate your photos so the text is upright, e.g. using popular scanner apps such as Microsoft Lens, Adobe Scan, or Genius Scan.</li>\n' +
        '    <li>Aim for 300&nbsp;dpi at A5 (approximately 1770&nbsp;\u00d7&nbsp;2480 pixels).</li>\n' +
        '    <li>Zoom to 100% and check legibility before uploading.</li>\n' +
        '    <li>Make sure your text is still readable at A5 size.</li>\n' +
        '</ul>',
};

function iliasPad(n) {
    return String(n).padStart(2, '0');
}

function iliasFormatLocalDate(date) {
    return `${date.getFullYear()}-${iliasPad(date.getMonth() + 1)}-${iliasPad(date.getDate())}`;
}

class IliasExerciseCreator {
    constructor(container) {
        this.container = container;
        if (!this.container) {
            throw new Error('ILIAS Creator container element not found.');
        }

        // Each assignment: { name, dateStr, deadlineOverride? }
        this.assignments = [];
        this.activeAssignmentIndex = -1;
        this.elements = {};
        this.calendar = null;
        this.controller = null;

        this.deadlineEditIndex = -1;
        this.weeklyMode = 'off'; // 'off' | 'pickFirst' | 'pickLast' | 'ready'
        this.weeklyFirstDate = null;
        this._flashTimers = [];
    }

    async buildUI() {
        try {
            const htmlContent = await window.electronAPI.loadIliasCreatorHtml();
            if (!htmlContent) {
                throw new Error('Received empty content for ilias_creator.html');
            }
            this.container.innerHTML = htmlContent;
        } catch (error) {
            console.error('Error building ILIAS Creator UI:', error);
            this.container.textContent = `Error loading ILIAS Creator UI: ${error.message}`;
        }
    }

    findElements() {
        this.elements = {
            exerciseTitle: this.container.querySelector('#ilias-exercise-title'),
            exerciseDescription: this.container.querySelector('#ilias-exercise-description'),
            instructionEditor: this.container.querySelector('#ilias-instruction-editor'),
            instructionSource: this.container.querySelector('#ilias-instruction-source'),
            toggleSourceBtn: this.container.querySelector('#ilias-toggle-source-btn'),
            loadTemplateBtn: this.container.querySelector('#ilias-load-template-btn'),
            templateLabel: this.container.querySelector('#ilias-template-label'),
            dateMode: this.container.querySelector('#ilias-date-mode'),
            deadlineOffset: this.container.querySelector('#ilias-deadline-offset'),
            offsetLabel: this.container.querySelector('#ilias-offset-label'),
            deadlineTime: this.container.querySelector('#ilias-deadline-time'),
            unitPrefix: this.container.querySelector('#ilias-unit-prefix'),
            emptyState: this.container.querySelector('#ilias-empty-state'),
            assignmentListSection: this.container.querySelector('#ilias-assignment-list-section'),
            assignmentTbody: this.container.querySelector('#ilias-assignment-tbody'),
            previewSection: this.container.querySelector('#ilias-preview-section'),
            previewTbody: this.container.querySelector('#ilias-preview-tbody'),
            mandatory: this.container.querySelector('#ilias-mandatory'),
            maxFiles: this.container.querySelector('#ilias-max-files'),
            generateBtn: this.container.querySelector('#ilias-generate-btn'),
            statusMessage: this.container.querySelector('#ilias-status-message'),
            calendarContainer: this.container.querySelector('#ilias-calendar-container'),
            weeklyBtn: this.container.querySelector('#ilias-weekly-btn'),
            weeklyPanel: this.container.querySelector('#ilias-weekly-panel'),
            weeklyFirst: this.container.querySelector('#ilias-weekly-first'),
            weeklyLast: this.container.querySelector('#ilias-weekly-last'),
            weeklyConfirm: this.container.querySelector('#ilias-weekly-confirm'),
            weeklyCancel: this.container.querySelector('#ilias-weekly-cancel'),
            weeklyHint: this.container.querySelector('#ilias-weekly-hint'),
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
            if (!chevronIcon) return;

            // Listen for Bootstrap collapse events
            targetElement.addEventListener('shown.bs.collapse', () => {
                chevronIcon.classList.replace('bi-chevron-down', 'bi-chevron-up');
            });
            targetElement.addEventListener('hidden.bs.collapse', () => {
                chevronIcon.classList.replace('bi-chevron-up', 'bi-chevron-down');
            });
        });
    }

    initCalendar() {
        if (!this.elements.calendarContainer) return;

        this.calendar = new VerticalCalendar(this.elements.calendarContainer, {
            numMonths: 6,
            startDate: new Date(),
            weekStartsOn: 1,
            enablePastDates: false,
            scrollable: true,
        });

        this.elements.calendarContainer.addEventListener('calendarRendered', () => {
            if (this.controller) this.controller.refresh();
        });

        // Hover preview for weekly mode
        this.elements.calendarContainer.addEventListener('mouseover', (e) => {
            if (this.weeklyMode !== 'pickLast') return;
            const dayEl = e.target.closest('.calendar-day');
            if (!dayEl || dayEl.classList.contains('other-month') || dayEl.classList.contains('past')) return;
            const hoverDate = dayEl.dataset.date;
            if (!hoverDate || hoverDate <= this.weeklyFirstDate) return;
            this.showWeeklyPreview(this.weeklyFirstDate, hoverDate);
        });
    }

    attachEventListeners() {
        this.elements.loadTemplateBtn?.addEventListener('click', () => this.loadTemplate());
        this.elements.generateBtn?.addEventListener('click', () => this.generateExerciseZip());

        // Editor toolbar
        this.initEditor();

        this.elements.deadlineTime?.addEventListener('blur', () => {
            this.elements.deadlineTime.value = this.snapToFiveMinutes(this.elements.deadlineTime.value);
        });

        // When settings change, recompute table display and preview
        const rerender = () => {
            this.renderAssignmentList();
            this.renderPreview();
        };
        this.elements.deadlineOffset?.addEventListener('change', rerender);
        this.elements.deadlineTime?.addEventListener('change', rerender);

        // Mode change: convert existing assignments' dateStr to the new mode's meaning
        this.elements.dateMode?.addEventListener('change', () => {
            this.convertAssignmentsForModeSwitch();
            this.updateOffsetLabel();
            rerender();
        });

        // Prefix change: renumber and rerender
        this.elements.unitPrefix?.addEventListener('change', () => {
            this.renumberAssignments();
            this.renderAssignmentList();
        });

        // Weekly generation
        this.elements.weeklyBtn?.addEventListener('click', () => this.startWeeklyMode());
        this.elements.weeklyCancel?.addEventListener('click', () => this.cancelWeeklyMode());
        this.elements.weeklyConfirm?.addEventListener('click', () => this.confirmWeekly());

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!this.container.offsetParent) return; // not visible
            if (this.weeklyMode !== 'off') {
                this.cancelWeeklyMode();
            } else if (this.deadlineEditIndex >= 0) {
                this.exitDeadlineEditMode();
                this.renderAssignmentList();
            }
        });
    }

    // Helpers

    getMode() { return this.elements.dateMode?.value || 'start'; }
    getOffset() { return parseInt(this.elements.deadlineOffset?.value || '7', 10); }
    getTime() { return this.elements.deadlineTime?.value || '00:00'; }
    getPrefix() { return this.elements.unitPrefix?.value?.trim() || 'Seite'; }

    /** Convert each assignment's dateStr when switching between start/deadline mode. */
    convertAssignmentsForModeSwitch() {
        const newMode = this.getMode();
        const offset = this.getOffset();

        this.assignments.forEach(a => {
            const [y, m, d] = a.dateStr.split('-').map(Number);
            const date = new Date(y, m - 1, d);

            if (newMode === 'deadline') {
                if (a.deadlineOverride) {
                    a.dateStr = a.deadlineOverride;
                    delete a.deadlineOverride;
                } else {
                    date.setDate(date.getDate() + offset);
                    a.dateStr = iliasFormatLocalDate(date);
                }
            } else {
                date.setDate(date.getDate() - offset);
                a.dateStr = iliasFormatLocalDate(date);
            }
        });

        this.assignments.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    }

    /** Convert UTC "YYYY-MM-DD HH:MM:SS" to CET/CEST date "YYYY-MM-DD". */
    utcToLocalDate(utcStr) {
        const cleaned = utcStr.replace(' ', 'T') + 'Z';
        const d = new Date(cleaned);
        if (isNaN(d.getTime())) return null;
        const cetDate = new Date(d.getTime() + 3600000); // UTC+1
        const y = cetDate.getUTCFullYear();
        const m = cetDate.getUTCMonth() + 1;
        const day = cetDate.getUTCDate();
        const h = cetDate.getUTCHours();
        const isCEST = this._isCEST(y, m, day, h);
        const localDate = isCEST ? new Date(d.getTime() + 7200000) : cetDate;
        return `${localDate.getUTCFullYear()}-${iliasPad(localDate.getUTCMonth() + 1)}-${iliasPad(localDate.getUTCDate())}`;
    }

    /** Check whether a CET date falls in CEST (1-based months). */
    _isCEST(year, month, day, hour) {
        const lastSunday = (y, m) => {
            const lastDay = new Date(Date.UTC(y, m, 0));
            const weekday = lastDay.getUTCDay(); // 0=Sunday
            return lastDay.getUTCDate() - (weekday === 0 ? 0 : weekday);
        };
        const lastSunMarch = lastSunday(year, 3);
        const lastSunOct = lastSunday(year, 10);
        const val = month * 1000000 + day * 10000 + hour * 100;
        const cestStart = 3 * 1000000 + lastSunMarch * 10000 + 2 * 100;
        const cestEnd = 10 * 1000000 + lastSunOct * 10000 + 3 * 100;
        return val >= cestStart && val < cestEnd;
    }

    /** Round to nearest 5 minutes (ILIAS limitation). */
    snapToFiveMinutes(timeStr) {
        const match = ILIAS_TIME_PATTERN.exec(timeStr);
        if (!match) return '00:00';
        const h = parseInt(match[1], 10);
        const m = Math.round(parseInt(match[2], 10) / 5) * 5;
        if (m === 60) return `${iliasPad(h + 1 > 23 ? 0 : h + 1)}:00`;
        return `${iliasPad(h)}:${iliasPad(m)}`;
    }

    updateOffsetLabel() {
        if (!this.elements.offsetLabel) return;
        this.elements.offsetLabel.textContent = this.getMode() === 'start'
            ? 'days after start'
            : 'days before deadline';
    }

    /** Compute start and deadline date strings for one assignment. */
    computeDatesForAssignment(assignment) {
        const dateStr = assignment.dateStr;
        const mode = this.getMode();
        const offset = this.getOffset();
        const [y, m, d] = dateStr.split('-').map(Number);

        if (mode === 'start') {
            const startDateStr = dateStr;
            let deadlineDateStr;
            let isOverridden = false;
            if (assignment.deadlineOverride) {
                deadlineDateStr = assignment.deadlineOverride;
                isOverridden = true;
            } else {
                const deadline = new Date(y, m - 1, d);
                deadline.setDate(deadline.getDate() + offset);
                deadlineDateStr = iliasFormatLocalDate(deadline);
            }
            return { startDateStr, deadlineDateStr, isOverridden };
        } else {
            const start = new Date(y, m - 1, d);
            start.setDate(start.getDate() - offset);
            return { startDateStr: iliasFormatLocalDate(start), deadlineDateStr: dateStr, isOverridden: false };
        }
    }

    // Editor

    initEditor() {
        const toolbar = this.container.querySelector('.ilias-editor-toolbar');
        if (!toolbar) return;

        this.sourceMode = false;

        // Toolbar button commands
        toolbar.querySelectorAll('button[data-cmd]').forEach(btn => {
            btn.addEventListener('mousedown', (e) => {
                // Prevent button click from stealing focus/selection from editor
                e.preventDefault();
            });
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const cmd = btn.dataset.cmd;
                document.execCommand(cmd, false, null);
            });
        });

        // Toggle source view
        this.elements.toggleSourceBtn?.addEventListener('click', () => {
            this.sourceMode = !this.sourceMode;
            if (this.sourceMode) {
                // Sync editor → source, but treat effectively-empty as truly empty
                this.elements.instructionSource.value = this.isEditorEmpty()
                    ? ''
                    : this.elements.instructionEditor.innerHTML;
                this.elements.instructionEditor.style.display = 'none';
                this.elements.instructionSource.style.display = '';
            } else {
                this.elements.instructionEditor.innerHTML = this.elements.instructionSource.value;
                this.elements.instructionSource.style.display = 'none';
                this.elements.instructionEditor.style.display = '';
            }
        });

        // Template dropdown
        const dropdown = toolbar.querySelector('.ilias-editor-dropdown');
        const toggle = toolbar.querySelector('.ilias-editor-dropdown-toggle');
        if (dropdown && toggle) {
            toggle.addEventListener('mousedown', (e) => e.preventDefault());
            toggle.addEventListener('click', (e) => {
                e.preventDefault();
                dropdown.classList.toggle('open');
            });
            dropdown.querySelectorAll('button[data-template]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    dropdown.classList.remove('open');
                    const lang = btn.dataset.template;
                    this.insertInstructionTemplate(lang);
                });
            });
            // Close dropdown on outside click
            document.addEventListener('click', (e) => {
                if (!dropdown.contains(e.target)) {
                    dropdown.classList.remove('open');
                }
            });
        }
    }

    /** Check whether the editor is effectively empty (browsers leave ghost markup). */
    isEditorEmpty() {
        const editor = this.elements.instructionEditor;
        if (!editor) return true;
        // Strip tags, collapse whitespace, check if anything remains
        const text = editor.innerText.replace(/\s/g, '');
        return text.length === 0;
    }

    /** Get the current instruction HTML (visual or source mode). */
    getInstructionHtml() {
        if (this.sourceMode) {
            return this.elements.instructionSource?.value || '';
        }
        if (this.isEditorEmpty()) return '';
        return this.elements.instructionEditor?.innerHTML || '';
    }

    /** Strip dangerous elements/attributes from imported HTML. */
    sanitizeHtml(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(el => el.remove());
        doc.querySelectorAll('*').forEach(el => {
            for (const attr of [...el.attributes]) {
                if (attr.name.startsWith('on') || attr.name === 'srcdoc') {
                    el.removeAttribute(attr.name);
                } else if (['href', 'src', 'action'].includes(attr.name)) {
                    const val = attr.value.trim().toLowerCase();
                    if (val.startsWith('javascript:') || val.startsWith('data:')) {
                        el.removeAttribute(attr.name);
                    }
                }
            }
        });
        return doc.body.innerHTML;
    }

    /** Set instruction HTML in both visual and source editor. */
    setInstructionHtml(html) {
        if (this.elements.instructionEditor) {
            this.elements.instructionEditor.innerHTML = html;
        }
        if (this.elements.instructionSource) {
            this.elements.instructionSource.value = html;
        }
    }

    // Templates

    insertInstructionTemplate(lang = 'de') {
        const editor = this.elements.instructionEditor;
        if (!editor) return;

        const template = ILIAS_INSTRUCTION_TEMPLATES[lang] || ILIAS_INSTRUCTION_TEMPLATES.de;
        if (this.isEditorEmpty()) {
            editor.innerHTML = template;
        } else {
            // Append after existing content
            editor.innerHTML = editor.innerHTML + template;
        }
        if (this.elements.instructionSource) {
            this.elements.instructionSource.value = editor.innerHTML;
        }
    }

    // Template loading

    async loadTemplate() {
        try {
            const result = await window.electronAPI.showOpenDialog({
                title: 'Select ILIAS Exercise Export ZIP',
                properties: ['openFile'],
                filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
            });

            if (result.canceled || result.filePaths.length === 0) return;

            const zipPath = result.filePaths[0];
            this.setStatus('Parsing ILIAS template...', 'info');

            const parsed = await window.electronAPI.parseIliasTemplate(zipPath);

            if (!parsed.success) {
                this.setStatus(`Error: ${parsed.message}`, 'error');
                return;
            }

            const data = parsed.data;
            if (data.exercise_title && this.elements.exerciseTitle) this.elements.exerciseTitle.value = data.exercise_title;
            if (data.exercise_description && this.elements.exerciseDescription) this.elements.exerciseDescription.value = data.exercise_description;
            if (data.instruction_html) this.setInstructionHtml(this.sanitizeHtml(data.instruction_html));

            // Import assignments if present — force start mode since dateStr will be start dates
            if (data.assignments && data.assignments.length > 0) {
                if (this.elements.dateMode) this.elements.dateMode.value = 'start';
                this.updateOffsetLabel();
                this.assignments = data.assignments.map(a => {
                    const startLocal = a.startTime ? this.utcToLocalDate(a.startTime) : null;
                    return {
                        name: a.title || '',
                        dateStr: startLocal || '',
                    };
                }).filter(a => a.dateStr);

                this.assignments.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
                this.renderAssignmentList();
                this.updateCalendarHighlights();
                this.updateGenerateButtonState();
                this.renderPreview();
            }

            const basename = await window.electronAPI.pathBasename(zipPath);
            this.elements.templateLabel.textContent = `Loaded: ${basename}`;
            const numAss = data.assignments ? data.assignments.length : 0;
            this.setStatus(`Template loaded: "${data.exercise_title}" (${numAss} assignments)`, 'success');
        } catch (error) {
            console.error('Error loading template:', error);
            this.setStatus(`Error: ${error.message}`, 'error');
        }
    }

    // Assignment management

    /** Called by VerticalCalendarController when a date is clicked. */
    onCalendarDateClicked(dateStr) {
        if (this.weeklyMode === 'pickFirst') {
            this.weeklyFirstDate = dateStr;
            this.elements.weeklyFirst.textContent = dateStr;
            this.weeklyMode = 'pickLast';
            this.elements.weeklyLast.textContent = '—';
            this.elements.weeklyConfirm.disabled = true;
            this.elements.weeklyHint.innerHTML = 'Now click the <strong>last</strong> lecture day.';
            this.clearRangeHighlights();
            const firstEl = this.calendar?.container?.querySelector(`.calendar-day[data-date="${dateStr}"]`);
            if (firstEl) firstEl.classList.add('ilias-start-marker');
            return;
        }
        if (this.weeklyMode === 'pickLast' || this.weeklyMode === 'ready') {
            if (dateStr <= this.weeklyFirstDate) return;
            this.elements.weeklyLast.textContent = dateStr;
            this.elements.weeklyConfirm.disabled = false;
            this.weeklyMode = 'ready';
            this.elements.weeklyHint.innerHTML = 'Press <strong>Create</strong> or pick a different last day.';
            this.showWeeklyPreview(this.weeklyFirstDate, dateStr);
            return;
        }

        if (this.deadlineEditIndex >= 0 && this.deadlineEditIndex < this.assignments.length) {
            const assignment = this.assignments[this.deadlineEditIndex];
            if (dateStr < assignment.dateStr) return;
            const computed = this.computeDatesForAssignment({ dateStr: assignment.dateStr });
            if (dateStr === computed.deadlineDateStr) {
                delete assignment.deadlineOverride;
            } else {
                assignment.deadlineOverride = dateStr;
            }
            const confirmedIndex = this.deadlineEditIndex;
            this.exitDeadlineEditMode();
            this.renderAssignmentList();
            this.renderPreview();
            this.flashRange(confirmedIndex);
            return;
        }

        const existingIndex = this.assignments.findIndex(a => a.dateStr === dateStr);

        if (existingIndex >= 0) {
            // Remove
            this.assignments.splice(existingIndex, 1);
            this.activeAssignmentIndex = -1;
        } else {
            // Insert in sorted order
            const newAssignment = { name: '', dateStr };
            let insertIdx = this.assignments.findIndex(a => a.dateStr > dateStr);
            if (insertIdx === -1) insertIdx = this.assignments.length;
            this.assignments.splice(insertIdx, 0, newAssignment);
            this.activeAssignmentIndex = insertIdx;
        }

        this.renumberAssignments();
        this.renderAssignmentList();
        this.updateCalendarHighlights();
        this.updateGenerateButtonState();
        this.renderPreview();

        // Flash range for newly added assignment
        if (existingIndex < 0) {
            const addedIdx = this.assignments.findIndex(a => a.dateStr === dateStr);
            if (addedIdx >= 0) this.flashRange(addedIdx);
        }
    }

    // Weekly generation

    startWeeklyMode() {
        this.weeklyMode = 'pickFirst';
        this.weeklyFirstDate = null;
        this.elements.weeklyPanel.style.display = '';
        this.elements.weeklyFirst.textContent = '—';
        this.elements.weeklyLast.textContent = '—';
        this.elements.weeklyConfirm.disabled = true;
        this.elements.weeklyHint.innerHTML = 'Click the <strong>first</strong> lecture day in the calendar.';
        this.clearRangeHighlights();
    }

    cancelWeeklyMode() {
        this.weeklyMode = 'off';
        this.weeklyFirstDate = null;
        this.elements.weeklyPanel.style.display = 'none';
        this.clearRangeHighlights();
    }

    /** Show weekly preview in calendar. */
    showWeeklyPreview(firstStr, lastStr) {
        this.clearRangeHighlights();

        const first = new Date(firstStr + 'T00:00:00');
        const last = new Date(lastStr + 'T00:00:00');

        // Mark first date blue
        const firstEl = this.calendar?.container?.querySelector(`.calendar-day[data-date="${firstStr}"]`);
        if (firstEl) firstEl.classList.add('ilias-start-marker');

        // Mark last date orange
        const lastEl = this.calendar?.container?.querySelector(`.calendar-day[data-date="${lastStr}"]`);
        if (lastEl) lastEl.classList.add('ilias-deadline-marker');

        // Mark weekly intermediate dates + range fill
        const cursor = new Date(first);
        cursor.setDate(cursor.getDate() + 1);
        while (cursor < last) {
            const ds = iliasFormatLocalDate(cursor);
            const el = this.calendar?.container?.querySelector(`.calendar-day[data-date="${ds}"]`);
            if (el && !el.classList.contains('other-month')) {
                // Is this a weekly date (same weekday as first)?
                if (cursor.getDay() === first.getDay()) {
                    el.classList.add('ilias-start-marker');
                } else {
                    el.classList.add('ilias-range');
                }
            }
            cursor.setDate(cursor.getDate() + 1);
        }
    }

    confirmWeekly() {
        const firstStr = this.elements.weeklyFirst.textContent;
        const lastStr = this.elements.weeklyLast.textContent;
        if (!firstStr || !lastStr || firstStr === '—' || lastStr === '—') return;

        const first = new Date(firstStr + 'T00:00:00');
        const last = new Date(lastStr + 'T00:00:00');
        const cursor = new Date(first);

        while (cursor <= last) {
            const dateStr = iliasFormatLocalDate(cursor);
            // Avoid duplicates
            if (!this.assignments.some(a => a.dateStr === dateStr)) {
                this.assignments.push({ name: '', dateStr });
            }
            cursor.setDate(cursor.getDate() + 7);
        }

        this.assignments.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
        this.renumberAssignments();
        this.cancelWeeklyMode();
        this.renderAssignmentList();
        this.updateCalendarHighlights();
        this.updateGenerateButtonState();
        this.renderPreview();
    }

    enterDeadlineEditMode(index) {
        this.deadlineEditIndex = index;
        this.renderAssignmentList();
        this.updateCalendarHighlights();
    }

    exitDeadlineEditMode() {
        this.deadlineEditIndex = -1;
        this.updateCalendarHighlights();
    }

    removeAssignment(index) {
        this.assignments.splice(index, 1);
        this.activeAssignmentIndex = -1;
        this.renumberAssignments();
        this.renderAssignmentList();
        this.updateCalendarHighlights();
        this.updateGenerateButtonState();
        this.renderPreview();
    }

    renumberAssignments() {
        const prefix = this.getPrefix();
        this.assignments.forEach((a, i) => {
            a.name = `${prefix} ${i + 1}`;
        });
    }

    // Rendering

    renderAssignmentList() {
        const tbody = this.elements.assignmentTbody;
        if (!tbody) return;

        const hasAssignments = this.assignments.length > 0;
        if (this.elements.emptyState) {
            this.elements.emptyState.style.display = hasAssignments ? 'none' : '';
        }
        if (this.elements.assignmentListSection) {
            this.elements.assignmentListSection.style.display = hasAssignments ? '' : 'none';
        }
        if (this.elements.previewSection) {
            this.elements.previewSection.style.display = hasAssignments ? '' : 'none';
        }

        tbody.replaceChildren();

        const mode = this.getMode();

        this.assignments.forEach((a, index) => {
            const { startDateStr, deadlineDateStr, isOverridden } = this.computeDatesForAssignment(a);

            const row = document.createElement('tr');
            row.classList.add('assignment-row');
            if (index === this.activeAssignmentIndex) {
                row.classList.add('active');
            }

            const idxCell = document.createElement('td');
            idxCell.classList.add('align-middle', 'text-center', 'fw-bold');
            idxCell.textContent = index + 1;
            row.appendChild(idxCell);

            const nameCell = document.createElement('td');
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.classList.add('form-control', 'form-control-sm', 'assignment-name-input');
            nameInput.value = a.name;
            nameInput.addEventListener('change', () => {
                this.assignments[index].name = nameInput.value;
            });
            nameCell.appendChild(nameInput);
            row.appendChild(nameCell);

            const startCell = document.createElement('td');
            startCell.classList.add('align-middle', 'small');
            startCell.textContent = startDateStr;
            row.appendChild(startCell);

            const deadlineCell = document.createElement('td');
            deadlineCell.classList.add('align-middle');
            if (mode === 'start') {
                const deadlineSpan = document.createElement('span');
                deadlineSpan.classList.add('ilias-deadline-cell', 'ilias-deadline-clickable');
                deadlineSpan.textContent = deadlineDateStr;
                deadlineSpan.title = 'Click to set deadline via calendar';
                if (isOverridden) {
                    deadlineSpan.classList.add('deadline-overridden');
                }
                if (this.deadlineEditIndex === index) {
                    deadlineSpan.classList.add('deadline-editing');
                }
                deadlineSpan.addEventListener('click', () => {
                    if (this.deadlineEditIndex === index) {
                        this.exitDeadlineEditMode();
                        this.renderAssignmentList();
                    } else {
                        this.enterDeadlineEditMode(index);
                    }
                });
                if (isOverridden) {
                    deadlineSpan.addEventListener('dblclick', () => {
                        delete this.assignments[index].deadlineOverride;
                        this.exitDeadlineEditMode();
                        this.renderAssignmentList();
                        this.renderPreview();
                    });
                }
                deadlineCell.appendChild(deadlineSpan);
            } else {
                deadlineCell.classList.add('small');
                deadlineCell.textContent = deadlineDateStr;
            }
            row.appendChild(deadlineCell);

            const deleteCell = document.createElement('td');
            deleteCell.classList.add('align-middle', 'text-center');
            const deleteBtn = document.createElement('button');
            deleteBtn.classList.add('btn', 'btn-sm', 'btn-outline-danger', 'py-0', 'px-1');
            deleteBtn.innerHTML = '<i class="bi bi-x"></i>';
            deleteBtn.title = `Remove ${a.name}`;
            deleteBtn.setAttribute('aria-label', `Remove ${a.name}`);
            deleteBtn.addEventListener('click', () => this.removeAssignment(index));
            deleteCell.appendChild(deleteBtn);
            row.appendChild(deleteCell);

            row.addEventListener('mouseenter', () => {
                if (this.deadlineEditIndex >= 0) return;
                this.clearRangeHighlights();
                this.showRangeForAssignment(index);
                this.scrollCalendarToDate(a.dateStr);
            });
            row.addEventListener('mouseleave', () => {
                if (this.deadlineEditIndex >= 0) return;
                this.clearRangeHighlights();
            });

            tbody.appendChild(row);
        });

        this.updateCalendarHighlights();
    }

    // Timestamps & Preview

    /** Compute timestamps for all assignments. */
    computeTimestamps() {
        if (!this.assignments.length) return null;

        const time = this.getTime();

        return this.assignments.map(a => {
            const { startDateStr, deadlineDateStr } = this.computeDatesForAssignment(a);
            return {
                title: a.name,
                startDate: `${startDateStr} 00:00`,
                deadlineDate: `${deadlineDateStr} ${time}`,
            };
        });
    }

    renderPreview() {
        const tbody = this.elements.previewTbody;
        if (!tbody) return;

        const data = this.computeTimestamps();
        if (!data) {
            tbody.replaceChildren();
            return;
        }

        tbody.replaceChildren();
        for (let i = 0; i < data.length; i++) {
            const a = data[i];
            const row = document.createElement('tr');
            for (const text of [i + 1, a.title, a.startDate, a.deadlineDate]) {
                const cell = document.createElement('td');
                cell.textContent = text;
                row.appendChild(cell);
            }
            tbody.appendChild(row);
        }
    }

    // Calendar colors: blue = start, orange = deadline, light orange = range

    static CALENDAR_CLASSES = ['ilias-start-marker', 'ilias-deadline-marker', 'ilias-range', 'ilias-fading'];

    updateCalendarHighlights() {
        if (this.controller) this.controller.reapplyHighlights();

        this.clearRangeHighlights();
        this.calendar?.container?.querySelectorAll('.calendar-day.ilias-deadline-permanent').forEach(el => {
            el.classList.remove('ilias-deadline-permanent');
        });

        // In deadline mode, restyle controller's blue marks to orange
        if (this.getMode() === 'deadline') {
            this.calendar?.container?.querySelectorAll('.calendar-day.assigned-date').forEach(el => {
                el.classList.remove('assigned-date');
                el.classList.add('ilias-deadline-permanent');
            });
        }
        if (this.deadlineEditIndex >= 0 && this.deadlineEditIndex < this.assignments.length) {
            this.showRangeForAssignment(this.deadlineEditIndex);
        }

        this.updateDeadlineEditBanner();
    }

    /** Scroll the calendar so the given date is visible. */
    scrollCalendarToDate(dateStr) {
        const dayEl = this.calendar?.container?.querySelector(`.calendar-day[data-date="${dateStr}"]`);
        if (!dayEl) return;

        let scrollable = dayEl.parentElement;
        while (scrollable && scrollable !== document.body) {
            const overflow = getComputedStyle(scrollable).overflowY;
            if ((overflow === 'auto' || overflow === 'scroll') && scrollable.scrollHeight > scrollable.clientHeight + 10) break;
            scrollable = scrollable.parentElement;
        }
        if (!scrollable || scrollable === document.body) return;

        const elRect = dayEl.getBoundingClientRect();
        const scrollRect = scrollable.getBoundingClientRect();
        if (elRect.top >= scrollRect.top + 50 && elRect.bottom <= scrollRect.bottom - 50) return;

        const elCenter = elRect.top + elRect.height / 2;
        const scrollCenter = scrollRect.top + scrollRect.height / 2;
        scrollable.scrollBy({ top: elCenter - scrollCenter, behavior: 'smooth' });
    }

    /** Remove transient highlights. Leaves assigned-date/permanent markers intact. */
    clearRangeHighlights() {
        const sel = IliasExerciseCreator.CALENDAR_CLASSES.map(c => `.calendar-day.${c}`).join(', ');
        this.calendar?.container?.querySelectorAll(sel).forEach(el => {
            IliasExerciseCreator.CALENDAR_CLASSES.forEach(c => el.classList.remove(c));
            el.style.removeProperty('background-color');
            el.style.removeProperty('outline-color');
            el.style.removeProperty('box-shadow');
            el.style.removeProperty('color');
            el.style.removeProperty('font-weight');
        });
    }

    /** Highlight start→deadline range for an assignment in the calendar. */
    showRangeForAssignment(index) {
        if (index < 0 || index >= this.assignments.length) return;
        const a = this.assignments[index];
        const { startDateStr, deadlineDateStr } = this.computeDatesForAssignment(a);

        const start = new Date(startDateStr + 'T00:00:00');
        const end = new Date(deadlineDateStr + 'T00:00:00');
        const cursor = new Date(start);
        cursor.setDate(cursor.getDate() + 1);
        while (cursor < end) {
            const ds = iliasFormatLocalDate(cursor);
            const el = this.calendar?.container?.querySelector(`.calendar-day[data-date="${ds}"]`);
            if (el && !el.classList.contains('other-month')) {
                el.classList.add('ilias-range');
            }
            cursor.setDate(cursor.getDate() + 1);
        }

        const startEl = this.calendar?.container?.querySelector(`.calendar-day[data-date="${startDateStr}"]`);
        if (startEl && !startEl.classList.contains('other-month') && !startEl.classList.contains('past')
            && !startEl.classList.contains('assigned-date')) {
            startEl.classList.add('ilias-start-marker');
        }

        const deadlineEl = this.calendar?.container?.querySelector(`.calendar-day[data-date="${deadlineDateStr}"]`);
        if (deadlineEl && !deadlineEl.classList.contains('other-month') && !deadlineEl.classList.contains('past')
            && !deadlineEl.classList.contains('ilias-deadline-marker')
            && !deadlineEl.classList.contains('ilias-deadline-permanent')) {
            deadlineEl.classList.add('ilias-deadline-marker');
        }
    }

    /** Show range briefly, then fade out. */
    _cancelFlashTimers() {
        this._flashTimers.forEach(id => clearTimeout(id));
        this._flashTimers = [];
    }

    flashRange(index) {
        this._cancelFlashTimers();
        this.clearRangeHighlights();
        this.showRangeForAssignment(index);

        this._flashTimers.push(setTimeout(() => {
            const sel = '.calendar-day.ilias-start-marker, .calendar-day.ilias-deadline-marker, .calendar-day.ilias-range';
            const els = this.calendar?.container?.querySelectorAll(sel);
            if (!els || !els.length) return;

            els.forEach(el => el.classList.add('ilias-fading'));
            void this.calendar.container.offsetHeight; // force reflow

            els.forEach(el => {
                const isOdd = el.classList.contains('odd-month');
                const targetBg = isOdd ? '#ededed' : '#ffffff';
                el.style.setProperty('background-color', targetBg, 'important');
                el.style.setProperty('outline-color', targetBg, 'important');
                el.style.setProperty('box-shadow', 'none', 'important');
                el.style.setProperty('color', '#333', 'important');
                el.style.setProperty('font-weight', 'normal', 'important');
            });

            this._flashTimers.push(setTimeout(() => this.clearRangeHighlights(), 1600));
        }, 800));
    }

    updateDeadlineEditBanner() {
        let banner = this.container.querySelector('#ilias-deadline-edit-banner');
        if (this.deadlineEditIndex >= 0 && this.deadlineEditIndex < this.assignments.length) {
            const a = this.assignments[this.deadlineEditIndex];
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'ilias-deadline-edit-banner';
                this.elements.calendarContainer?.parentElement?.insertBefore(banner, this.elements.calendarContainer);
            }
            banner.replaceChildren();
            const icon = document.createElement('i');
            icon.className = 'bi bi-calendar-event me-1';
            banner.appendChild(icon);
            banner.append('Click a date to set deadline for ');
            const strong = document.createElement('strong');
            strong.textContent = a.name;
            banner.appendChild(strong);
            banner.append(' ');
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'btn btn-sm btn-outline-secondary ms-2 py-0 px-1';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.addEventListener('click', () => {
                this.exitDeadlineEditMode();
                this.renderAssignmentList();
            });
            banner.appendChild(cancelBtn);
        } else if (banner) {
            banner.remove();
        }
    }

    updateGenerateButtonState() {
        if (!this.elements.generateBtn) return;
        this.elements.generateBtn.disabled = this.assignments.length === 0;
    }

    setStatus(message, type = 'info', { html = false } = {}) {
        if (this.elements.statusMessage) {
            if (html) {
                this.elements.statusMessage.innerHTML = message;
            } else {
                this.elements.statusMessage.textContent = message;
            }
            this.elements.statusMessage.className = `status-message ${type}`;
        }
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    setController(controller) {
        this.controller = controller;
    }

    async generateExerciseZip() {
        if (this.assignments.length === 0) return;

        const timestamps = this.computeTimestamps();
        if (!timestamps) {
            this.setStatus('No assignments to generate.', 'error');
            return;
        }

        const exerciseTitle = this.elements.exerciseTitle?.value?.trim() || 'Exercise';
        const now = new Date();
        const ts = `${now.getFullYear()}${iliasPad(now.getMonth() + 1)}${iliasPad(now.getDate())}-${iliasPad(now.getHours())}${iliasPad(now.getMinutes())}${iliasPad(now.getSeconds())}`;
        const suggestedFilename = `ilias-exercise-${ts}.zip`;

        const saveResult = await window.electronAPI.showSaveDialog({
            title: 'Save ILIAS Exercise ZIP',
            defaultPath: suggestedFilename,
            filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
        });

        if (saveResult.canceled || !saveResult.filePath) {
            this.setStatus('Save cancelled.', 'info');
            return;
        }

        try {
            this.setStatus('Generating ILIAS exercise ZIP...', 'info');
            this.elements.generateBtn.disabled = true;

            const config = {
                exercise_title: exerciseTitle,
                exercise_description: this.elements.exerciseDescription?.value || '',
                instruction_html: this.getInstructionHtml(),
                mandatory: this.elements.mandatory?.checked || false,
                max_files: parseInt(this.elements.maxFiles?.value || '1', 10),
                assignments: timestamps,
            };

            const result = await window.electronAPI.generateIliasExercise({
                config,
                outputPath: saveResult.filePath,
            });

            if (result.success) {
                const basename = await window.electronAPI.pathBasename(saveResult.filePath);
                this.setStatus(
                    `Saved: <strong>${this.escapeHtml(basename)}</strong> (Exercise ID: ${result.excId}, ${result.numUnits} units)` +
                    '<br><br>⚠️ Do not rename the ZIP file — ILIAS requires the exact filename.' +
                    '<br><br>Import into ILIAS: open your course → <em>Add New Object</em> → <em>Exercise</em> ' +
                    '→ <em>Option 2: Import Exercise</em> → select the ZIP file and import.',
                    'success', { html: true }
                );
            } else {
                this.setStatus(`Error: ${result.message}`, 'error');
            }
        } catch (error) {
            console.error('Error generating ILIAS exercise:', error);
            this.setStatus(`Error: ${error.message}`, 'error');
        } finally {
            this.updateGenerateButtonState();
        }
    }

    static initialize(container) {
        return new IliasExerciseCreator(container);
    }
}

window.IliasExerciseCreator = IliasExerciseCreator;
