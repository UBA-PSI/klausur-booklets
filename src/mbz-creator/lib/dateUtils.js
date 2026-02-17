/**
 * Parse date and time strings into a Date object representing UTC time.
 * @param {string} dateStr - Date in YYYY-MM-DD
 * @param {string} timeStr - Time in HH:MM:SS
 * @returns {Date}
 */
function parseDatetimeUTC(dateStr, timeStr) {
    // Append Z to signify UTC
    const dt = new Date(`${dateStr}T${timeStr}Z`);
    if (isNaN(dt.getTime())) {
        throw new Error(`Invalid date/time for UTC: ${dateStr} ${timeStr}`);
    }
    return dt;
}

module.exports = {
    parseDatetimeUTC,
};
