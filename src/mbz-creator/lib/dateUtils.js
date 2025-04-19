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

/**
 * Generate assignment dates based on options (mimics Python logic but uses UTC)
 * @param {Object} opts
 * @returns {Array<Object>} Array of assignment info with UTC timestamps
 */
function generateAssignmentDates(opts) {
  const assignments = [];
  const extraMinutes = opts.extraTime || 60;
  const namePrefix = opts.assignmentNamePrefix || 'Page';
  // Get current time as UTC timestamp for initial activation
  const nowTs = Math.floor(Date.now() / 1000);

  // Option A: First date + consecutive weeks
  if (opts.firstSubmissionDate && opts.numConsecutiveWeeks) {
    const firstDt = parseDatetimeUTC(opts.firstSubmissionDate, opts.submissionTime || '23:59:59');
    let previousCutoffTs = null;
    for (let i = 0; i < opts.numConsecutiveWeeks; i++) {
      // Calculate future dates based on UTC milliseconds from the first UTC date
      const dueDt = new Date(firstDt.getTime() + i * 7 * 24 * 60 * 60 * 1000);
      const dueTs = Math.floor(dueDt.getTime() / 1000);
      const cutoffTs = dueTs + extraMinutes * 60;
      let activationTs;
      if (i === 0) {
        activationTs = nowTs;
      } else {
        activationTs = previousCutoffTs;
      }
      assignments.push({
        name: `${namePrefix} ${i + 1}`,
        // due_dt and cutoff_dt are less relevant now we focus on TS
        due_ts: dueTs,
        cutoff_ts: cutoffTs,
        activation_ts: activationTs,
      });
      previousCutoffTs = cutoffTs;
    }
  }
  // Option B: List of dates
  else if (opts.submissionDates) {
    const dateList = opts.submissionDates.split(',').map(s => s.trim());
    let previousCutoffTs = null;
    for (let i = 0; i < dateList.length; i++) {
      const dueDt = parseDatetimeUTC(dateList[i], opts.submissionTime || '23:59:59');
      const dueTs = Math.floor(dueDt.getTime() / 1000);
      const cutoffTs = dueTs + extraMinutes * 60;
      let activationTs;
      if (i === 0) {
        activationTs = nowTs;
      } else {
        activationTs = previousCutoffTs;
      }
      assignments.push({
        name: `${namePrefix} ${i + 1}`,
        due_ts: dueTs,
        cutoff_ts: cutoffTs,
        activation_ts: activationTs,
      });
      previousCutoffTs = cutoffTs;
    }
  }
  // Handle case where neither date option is specified (use defaults)
  else if (opts.numAssignments) {
       let previousCutoffTs = null;
       const now = new Date(); // Use current time for relative calculation
       for (let i = 0; i < opts.numAssignments; i++) {
            // This default logic might need refinement depending on desired behavior
            // Let's make it relative to 'now' for simplicity, assuming weekly deadlines
            const dueDt = new Date(now.getTime() + (i + 1) * 7 * 24 * 60 * 60 * 1000);
            const dueTs = Math.floor(dueDt.getTime() / 1000);
            const cutoffTs = dueTs + extraMinutes * 60;
            let activationTs;
            if (i === 0) {
                activationTs = nowTs;
            } else {
                activationTs = previousCutoffTs;
            }
            assignments.push({
                name: `${namePrefix} ${i + 1}`,
                due_ts: dueTs,
                cutoff_ts: cutoffTs,
                activation_ts: activationTs,
            });
            previousCutoffTs = cutoffTs;
       }
  }
  return assignments;
}

module.exports = {
  parseDatetimeUTC, // Export the new UTC parser
  generateAssignmentDates,
}; 