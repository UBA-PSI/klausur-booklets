// Utility functions for the MBZ Batch Creator module.

const fs = require('fs').promises;
const path = require('path');

/**
 * Formats a Unix timestamp into a human-readable date and time string
 * based on the system's default locale.
 *
 * @param {number} timestamp - Unix timestamp (seconds since epoch).
 * @returns {string} Formatted date and time string, or 'Invalid Date' if timestamp is invalid.
 */
function formatTimestamp(timestamp) {
  if (typeof timestamp !== 'number' || isNaN(timestamp)) {
    return 'Invalid Date';
  }
  // Multiply by 1000 to convert seconds to milliseconds for Date constructor
  const date = new Date(timestamp * 1000);
  // Use locale string for better readability
  return date.toLocaleString();
}

/**
 * Converts a Date object and specific hour/minute into a Unix timestamp (seconds).
 *
 * @param {Date} date - The Date object (only the date part is used).
 * @param {number} hour - Hour (0-23).
 * @param {number} minute - Minute (0-59).
 * @returns {number} Unix timestamp in seconds.
 */
function dateTimeToTimestamp(date, hour, minute) {
  if (!(date instanceof Date) || isNaN(date)) {
      throw new Error('Invalid Date object provided to dateTimeToTimestamp');
  }
  const d = new Date(date); // Clone the date to avoid modifying the original
  d.setHours(hour, minute, 0, 0); // Set time, reset seconds and milliseconds
  return Math.floor(d.getTime() / 1000); // Convert ms to seconds
}

/**
 * Recursively removes a directory and its contents.
 * Logs errors to the console if removal fails.
 *
 * @param {string} dirPath - Path to the directory to remove.
 * @returns {Promise<void>}
 */
async function cleanupTempDir(dirPath) {
  try {
    // Check if path exists before attempting removal
    await fs.access(dirPath);
    console.log(`Attempting to remove directory: ${dirPath}`);
    await fs.rm(dirPath, { recursive: true, force: true });
    console.log(`Successfully removed directory: ${dirPath}`);
  } catch (error) {
    // Log error if directory doesn't exist or removal fails
    if (error.code === 'ENOENT') {
        console.log(`Directory not found, no cleanup needed: ${dirPath}`);
    } else {
        console.error(`Error removing directory ${dirPath}:`, error);
        // Depending on requirements, you might want to re-throw or handle differently
    }
  }
}

module.exports = {
  formatTimestamp,
  dateTimeToTimestamp,
  cleanupTempDir
}; 