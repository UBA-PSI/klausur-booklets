/**
 * Parse date and time strings into a Date object representing local time.
 * @param {string} dateStr - Date in YYYY-MM-DD
 * @param {string} timeStr - Time in HH:MM:SS
 * @returns {Date}
 */
function parseDatetimeLocal(dateStr, timeStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        throw new Error(`Invalid date/time: ${dateStr} ${timeStr}`);
    }
    if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(timeStr)) {
        throw new Error(`Invalid date/time: ${dateStr} ${timeStr}`);
    }
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes, seconds] = timeStr.split(':').map(Number);
    const dt = new Date(year, month - 1, day, hours || 0, minutes || 0, seconds || 0);
    if (isNaN(dt.getTime())) {
        throw new Error(`Invalid date/time: ${dateStr} ${timeStr}`);
    }
    return dt;
}

/**
 * Convert a date and time string to a Unix timestamp (seconds) in local time.
 * @param {string} dateStr - Date in YYYY-MM-DD
 * @param {string} timeStr - Time in HH:MM:SS
 * @returns {number} Unix timestamp in seconds
 */
function dateToUnixTimestamp(dateStr, timeStr) {
    return Math.floor(parseDatetimeLocal(dateStr, timeStr).getTime() / 1000);
}

/**
 * Compute timestamps for assignments grouped by date.
 * Pure function — no DOM dependencies.
 * @param {Array<{moduleId: string, name: string, dateStr: string, timeStr: string}>} assignments
 * @param {object} [options]
 * @param {number} [options.gracePeriodMinutes=5] - Minutes between due and cutoff
 * @param {string} [options.openMode='chain'] - 'chain' or 'fixed'
 * @param {number} [options.openDurationDays=7] - Days before due for fixed-duration activation
 * @returns {Array<{moduleId: string, name: string, due_ts: number, cutoff_ts: number, activation_ts: number}>|null}
 */
function computeAssignmentTimestamps(assignments, { gracePeriodMinutes = 5, openMode = 'chain', openDurationDays = 7 } = {}) {
    if (!assignments || assignments.length === 0 || !assignments.every(a => a.dateStr)) {
        return null;
    }

    const dateGroupMap = new Map();
    for (const a of assignments) {
        let group = dateGroupMap.get(a.dateStr);
        if (!group) {
            group = [];
            dateGroupMap.set(a.dateStr, group);
        }
        group.push(a);
    }
    const groups = [...dateGroupMap.values()];

    const result = [];
    let prevGroupCutoff = null;

    for (const group of groups) {
        const [year, month, day] = group[0].dateStr.split('-').map(Number);
        const timeParts = group[0].timeStr.split(':').map(Number);
        const dueDate = new Date(year, month - 1, day, timeParts[0] || 0, timeParts[1] || 0, timeParts[2] || 0);
        const due_ts = Math.floor(dueDate.getTime() / 1000);
        const cutoff_ts = due_ts + gracePeriodMinutes * 60;

        const useChainedOpen = openMode === 'chain' && prevGroupCutoff !== null;
        const activation_ts = useChainedOpen
            ? prevGroupCutoff
            : due_ts - openDurationDays * 86400;

        for (const ga of group) {
            result.push({
                moduleId: ga.moduleId,
                name: ga.name,
                due_ts,
                cutoff_ts,
                activation_ts,
            });
        }

        prevGroupCutoff = cutoff_ts;
    }

    return result;
}

module.exports = {
    parseDatetimeLocal,
    dateToUnixTimestamp,
    computeAssignmentTimestamps,
};
