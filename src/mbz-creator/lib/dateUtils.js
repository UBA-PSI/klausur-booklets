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

module.exports = {
    parseDatetimeLocal,
    dateToUnixTimestamp,
};
