const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Import functions from other modules
const { extractMbz, createMbz } = require('./archive');
const { deleteDotfiles, findAssignmentTemplates } = require('./fileHelpers');
const { extractIds } = require('./idUtils');
const { modifyAssignment, createNewAssignmentFiles } = require('./assignmentFiles');
const { updateSectionXml, updateMoodleBackupXml } = require('./manifest');
// Note: dateUtils is not directly used here as assignment dates are expected in options

/**
 * Orchestrates the modification of a Moodle backup (.mbz) file.
 * Closely follows the logic of the Python script modify_moodle_backup.py.
 * @param {object} options - Configuration options.
 * @param {string} options.inputMbzPath - Path to the input .mbz file.
 * @param {string} options.outputMbzPath - Path for the output .mbz file.
 * @param {Array<object>} options.assignments - Array of assignment data objects.
 *   Each object should have: { name: string, due_ts: number, cutoff_ts: number, activation_ts?: number }
 * @param {string} [options.sectionTitle] - Optional title for the course section.
 * @param {number} [options.targetStartTimestamp] - Optional target course start date (Unix timestamp).
 */
async function modifyMoodleBackup(options) {
  const {
    inputMbzPath,
    outputMbzPath,
    assignments = [], // Default to empty array if not provided
    sectionTitle,
    targetStartTimestamp,
  } = options;

  if (!inputMbzPath || !outputMbzPath) {
    throw new Error("Missing required options: inputMbzPath and outputMbzPath");
  }

  const outputFilename = path.basename(outputMbzPath);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbz-creator-'));
  console.log(`Using temporary directory: ${tempDir}`);

  try {
    // 1. Extract
    console.log(`Extracting ${inputMbzPath}...`);
    await extractMbz(inputMbzPath, tempDir);
    console.log("Extraction complete.");

    // 1.5 Delete dotfiles
    console.log("Deleting dotfiles...");
    await deleteDotfiles(tempDir);
    console.log("Dotfile deletion complete.");

    // 2. Extract IDs
    console.log("Extracting existing IDs...");
    const ids = await extractIds(tempDir);
    console.log("ID extraction complete:", ids);
    const originalAssignmentCount = ids.existing_module_ids.length;

    if (!ids.section_id) {
      throw new Error("Could not extract required section_id from backup files. Cannot proceed.");
    }

    // 3. Find Templates
    console.log("Finding assignment templates...");
    const templates = await findAssignmentTemplates(tempDir);
    // Check if templates are needed (i.e., if adding new assignments)
    if (!templates && assignments.length > originalAssignmentCount) {
        throw new Error("Error: No existing assignments found to use as template, but new assignments are requested.");
    }
    const { assignTemplate, inforefTemplate } = templates || { assignTemplate: '', inforefTemplate: '' };
    if (templates) {
        console.log("Assignment templates found.");
    } else if (assignments.length <= originalAssignmentCount) {
        console.log("No templates found, but only modifying existing assignments.");
    }


    // 4. Initialize ID counters for creating new items
    // Follow Python logic: start incrementing from the max found ID
    let current_module_id = ids.max_module_id;
    let current_activity_id = ids.max_activity_id;
    let current_grade_item_id = ids.max_grade_item_id;
    let current_plugin_config_id = ids.max_plugin_config_id + 1; // Start from next available ID
    let current_context_id = ids.max_context_id;
    let current_grading_area_id = ids.max_grading_area_id;
    let current_sortorder = ids.max_sortorder;

    const final_assignment_details = []; // Holds {name, moduleid} for moodle_backup.xml update
    const final_module_ids = [];       // Holds all module IDs for section.xml update
    const added_module_ids = [];       // Holds only the *newly added* module IDs

    // 5. Process Assignments (Modify or Add)
    console.log(`Processing target of ${assignments.length} assignments...`);
    for (let i = 0; i < assignments.length; i++) {
      const assignmentInfo = assignments[i]; // { name, due_ts, cutoff_ts, activation_ts? }

      if (!assignmentInfo || !assignmentInfo.name || typeof assignmentInfo.due_ts !== 'number' || typeof assignmentInfo.cutoff_ts !== 'number') {
          console.warn(`Warning: Skipping assignment index ${i} due to missing/invalid data.`);
          continue;
      }


      if (i < originalAssignmentCount) {
        // --- Modify existing assignment ---
        const module_id = ids.existing_module_ids[i];
        const assignXmlPath = path.join(tempDir, 'activities', `assign_${module_id}`, 'assign.xml');
        console.log(`Modifying existing assignment ${i + 1} (Module ID: ${module_id})...`);
        try {
          const modified = await modifyAssignment(
            assignXmlPath,
            assignmentInfo.name,
            assignmentInfo.due_ts,
            assignmentInfo.cutoff_ts,
            assignmentInfo.activation_ts // Pass optional activation time
          );
          if (modified) {
              console.log(`  Successfully modified assign.xml for module ${module_id}`);
          } else {
              console.log(`  No changes needed for assign.xml for module ${module_id}`);
          }
        } catch (modErr) {
           // Log error but continue, similar to Python script's behavior
           console.warn(`  Warning: Failed to modify assignment ${i + 1} (Module ID: ${module_id}): ${modErr.message}`);
        }
        // Add details for manifest updates
        final_module_ids.push(module_id);
        final_assignment_details.push({ name: assignmentInfo.name, moduleid: module_id });

      } else {
        // --- Add new assignment ---
         if (!assignTemplate || !inforefTemplate) {
             // This case should be caught earlier, but double-check
             console.error("Error: Cannot add new assignment - missing template content. Stopping assignment processing.");
             break;
         }

        // Increment IDs *before* creating the new files
        current_module_id += 1;
        current_activity_id += 1;
        current_grade_item_id += 1;
        current_context_id += 1;
        current_grading_area_id += 1;
        current_sortorder += 1;

        console.log(`Creating new assignment ${i + 1} (New Module ID: ${current_module_id})...`);

        try {
            const next_plugin_id = await createNewAssignmentFiles(
              tempDir,
              assignTemplate,
              inforefTemplate,
              current_module_id,
              current_activity_id,
              current_plugin_config_id,
              current_grade_item_id,
              current_context_id,
              current_grading_area_id,
              current_sortorder,
              assignmentInfo, // Pass the whole info object { name, due_ts, cutoff_ts, activation_ts? }
              ids.section_id
            );
            current_plugin_config_id = next_plugin_id; // Update for the next potential new assignment
            added_module_ids.push(current_module_id); // Track added IDs for moodle_backup.xml settings
            final_module_ids.push(current_module_id); // Add to sequence for section.xml
            final_assignment_details.push({ name: assignmentInfo.name, moduleid: current_module_id }); // Add to details for moodle_backup.xml activities
            console.log(`  Successfully created files for new assignment (Module ID: ${current_module_id})`);
        } catch (createErr) {
            console.error(`  Error: Failed to create files for new assignment ${i + 1} (Module ID: ${current_module_id}): ${createErr.message}`);
            // Stop processing further assignments if creation fails? Python script doesn't explicitly stop here either.
            // Let's break the loop for safety.
            break;
        }
      }
    } // End assignment loop
    console.log("Assignment processing complete.");

    // 6. Update Manifest Files
    console.log("Updating manifest files...");
    // Section XML
    const sectionXmlPath = path.join(tempDir, 'sections', `section_${ids.section_id}`, 'section.xml');
    try {
        const sectionUpdated = await updateSectionXml(sectionXmlPath, final_module_ids, sectionTitle);
        if (sectionUpdated === false) { // updateSectionXml returns false on error, true otherwise
             console.warn(`Warning: Error occurred during section.xml update.`);
        } else {
             console.log("section.xml update attempt finished."); // It returns true even if no changes made
        }
    } catch (sectionErr) {
         console.error(`Error updating section.xml: ${sectionErr.message}`);
         // Decide if this is fatal
    }


    // Moodle Backup XML
    const moodleBackupXmlPath = path.join(tempDir, 'moodle_backup.xml');
    const newBackupId = crypto.randomUUID().replace(/-/g, ''); // Generate new random backup ID
    console.log(`Generated new backup ID: ${newBackupId}`);
    try {
        const moodleBackupUpdated = await updateMoodleBackupXml(
          moodleBackupXmlPath,
          outputFilename,
          ids.original_backup_id, // Use the extracted original ID
          newBackupId,
          final_assignment_details,
          ids.section_id,
          added_module_ids, // Pass only the IDs of *newly added* assignments
          sectionTitle,
          targetStartTimestamp
        );
         if (moodleBackupUpdated === false && !added_module_ids.length && !sectionTitle && !targetStartTimestamp && outputFilename === path.basename(inputMbzPath)) {
             // updateMoodleBackupXml returns false if no changes were needed *or* if an error occurred.
             // If we didn't expect changes, this might be okay.
             console.log("moodle_backup.xml update function reported no changes needed.");
         } else if (moodleBackupUpdated === false) {
             console.warn("Warning: moodle_backup.xml update function reported an error or failed to make expected changes.");
         } else {
             console.log("moodle_backup.xml update attempt finished.");
         }
    } catch (mbXmlErr) {
        console.error(`Error updating moodle_backup.xml: ${mbXmlErr.message}`);
        // This is likely fatal
        throw mbXmlErr;
    }
    console.log("Manifest update complete.");

    // 7. Truncate log file (Mimicking Python script)
    const logFilePath = path.join(tempDir, 'moodle_backup.log');
    console.log("Attempting to truncate log file...");
    try {
      // Check if file exists before truncating
      await fs.access(logFilePath);
      await fs.truncate(logFilePath, 0);
      console.log("moodle_backup.log truncated.");
    } catch (logErr) {
      if (logErr.code === 'ENOENT') { // ENOENT = Error NO ENTry (file doesn't exist)
          console.log("moodle_backup.log not found, skipping truncation.");
      } else {
        // Log other errors but don't stop the process
        console.warn(`Warning: Could not truncate log file ${logFilePath}: ${logErr.message}`);
      }
    }

    // 8. Re-pack Archive
    console.log(`Creating final archive ${outputMbzPath}...`);
    await createMbz(tempDir, outputMbzPath);
    console.log(`Archive created successfully: ${outputMbzPath}`);

    console.log("Script finished successfully.");

  } catch (error) {
    console.error("An error occurred during the process:", error);
    // Ensure the error is propagated up
    throw error;
  } finally {
    // 9. Clean up temporary directory
    console.log(`Cleaning up temporary directory ${tempDir}...`);
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log(`Temporary directory ${tempDir} cleaned up.`);
    } catch (cleanupErr) {
      // Log cleanup error but don't throw, as main process might have finished
      console.error(`Error cleaning up temporary directory ${tempDir}: ${cleanupErr}`);
    }
  }
}

module.exports = {
  modifyMoodleBackup,
}; 