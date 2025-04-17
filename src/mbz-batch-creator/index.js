// Main module for MBZ Batch Assignment Creator

// Dependencies
const { analyzeMbzTemplate } = require('./parser');
const { generateBatchMbz } = require('./generator');
const { formatTimestamp, dateTimeToTimestamp, cleanupTempDir } = require('./utils');
const path = require('path');

/**
 * Main function orchestrating the batch assignment creation process.
 * Takes an options object and returns a result object with success status and message.
 *
 * @param {object} options - Configuration options.
 * @param {string} options.mbzFilePath - Path to the template MBZ file.
 * @param {Date[]} options.selectedDates - Array of Date objects for assignment deadlines.
 * @param {number} options.timeHour - Hour (0-23) for the assignment deadline.
 * @param {number} options.timeMinute - Minute (0-59) for the assignment deadline.
 * @param {string} options.namePrefix - Prefix for the generated assignment names.
 * @param {string} [options.outputDir] - Directory to save the generated MBZ (defaults to input directory).
 * @returns {Promise<object>} Result object { success: boolean, message: string, outputPath?: string, error?: Error }
 */
async function createBatchAssignments(options) {
  const {
    mbzFilePath,
    selectedDates,
    timeHour,
    timeMinute,
    namePrefix,
    outputDir
  } = options;

  let templateInfo = null;
  let result = { success: false, message: 'An unknown error occurred.' };

  try {
    // Validate inputs (basic example)
    if (!mbzFilePath || !selectedDates || selectedDates.length === 0) {
      throw new Error('Missing required input: MBZ file and selected dates.');
    }
    if (typeof timeHour !== 'number' || typeof timeMinute !== 'number') {
        throw new Error('Missing required input: Time for deadlines.');
    }

    // 1. Analyze the template MBZ
    console.log(`Analyzing template: ${mbzFilePath}`);
    templateInfo = await analyzeMbzTemplate(mbzFilePath);
    console.log('Template analysis complete.');

    // Generate output filename
    const originalName = path.basename(mbzFilePath, '.mbz');
    const resolvedOutputDir = outputDir || path.dirname(mbzFilePath);
    const outputPath = path.join(
      resolvedOutputDir,
      `${originalName}-batch-${Date.now()}.mbz` // Add timestamp for uniqueness
    );

    // 2. Generate new MBZ with batch assignments
    console.log(`Generating batch MBZ to: ${outputPath}`);
    const generationResult = await generateBatchMbz({
      templateInfo,
      selectedDates,
      timeHour,
      timeMinute,
      namePrefix: namePrefix || 'Assignment', // Default prefix
      outputPath
    });
    console.log('Batch generation complete.');

    result = {
      success: true,
      message: `Successfully created ${generationResult.numAssignments} assignments.`,
      outputPath: generationResult.outputPath
    };

  } catch (error) {
    console.error('Error during batch assignment creation:', error);
    result = {
      success: false,
      message: `Error: ${error.message}`,
      error
    };
  } finally {
    // 3. Clean up temporary directory regardless of success/failure
    if (templateInfo?.tempDir) {
      console.log(`Cleaning up temporary directory: ${templateInfo.tempDir}`);
      try {
        cleanupTempDir(templateInfo.tempDir);
        console.log('Temporary directory cleaned up.');
      } catch (cleanupError) {
        console.error('Error cleaning up temporary directory:', cleanupError);
        // Append cleanup error message if main process succeeded but cleanup failed
        if (result.success) {
            result.message += ` (Warning: Failed to cleanup temporary directory: ${cleanupError.message})`;
        }
      }
    }
  }

  return result;
}

// Export the main function and any helpers needed by the UI
module.exports = {
  createBatchAssignments,
  formatTimestamp // Expose for potential UI use
}; 