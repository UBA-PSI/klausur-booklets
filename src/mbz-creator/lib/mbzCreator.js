const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { extractMbz, createMbz } = require('./archive');
const { deleteDotfiles } = require('./fileHelpers');
const { extractManifestIds } = require('./idUtils');
const { parseAssignment, modifyAssignment } = require('./assignmentFiles');
const { updateSectionXml, updateMoodleBackupXml } = require('./manifest');

/**
 * Extracts an MBZ file and discovers all assignments inside it.
 * Returns a structured list of assignments with their current names and dates.
 * @param {string} mbzPath - Path to the .mbz file
 * @returns {Promise<Object[]>} Array of assignment objects
 */
async function parseAssignmentsFromMbz(mbzPath) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbz-parse-'));

    try {
        await extractMbz(mbzPath, tempDir);

        const activityDir = path.join(tempDir, 'activities');
        const assignments = [];

        let entries;
        try {
            entries = await fs.readdir(activityDir, { withFileTypes: true });
        } catch (e) {
            throw new Error('No activities directory found in MBZ file.');
        }

        // Collect assign_ directories and sort them naturally
        const assignDirs = entries
            .filter(e => e.isDirectory() && e.name.startsWith('assign_'))
            .sort((a, b) => {
                const numA = parseInt(a.name.replace('assign_', ''), 10);
                const numB = parseInt(b.name.replace('assign_', ''), 10);
                return numA - numB;
            });

        for (const dir of assignDirs) {
            const moduleId = dir.name.replace('assign_', '');
            const assignXmlPath = path.join(activityDir, dir.name, 'assign.xml');
            const parsed = await parseAssignment(assignXmlPath, moduleId);
            if (parsed) {
                assignments.push(parsed);
            }
        }

        return assignments;
    } finally {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

/**
 * Modifies an existing MBZ backup: updates assignment names, timestamps, and metadata.
 * No new assignments are created — only existing ones are modified.
 * @param {object} options
 * @param {string} options.inputMbzPath - Path to the input .mbz file
 * @param {string} options.outputMbzPath - Path for the output .mbz file
 * @param {Array<object>} options.assignments - Array of { moduleId, name, due_ts, cutoff_ts, activation_ts? }
 * @param {string} [options.sectionTitle] - Optional title for the course section
 * @param {number} [options.targetStartTimestamp] - Optional target course start date (Unix timestamp)
 */
async function modifyMoodleBackup(options) {
    const {
        inputMbzPath,
        outputMbzPath,
        assignments = [],
        sectionTitle,
        targetStartTimestamp,
    } = options;

    if (!inputMbzPath || !outputMbzPath) {
        throw new Error('Missing required options: inputMbzPath and outputMbzPath');
    }

    const outputFilename = path.basename(outputMbzPath);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbz-creator-'));

    try {
        // 1. Extract
        await extractMbz(inputMbzPath, tempDir);

        // 2. Delete dotfiles
        await deleteDotfiles(tempDir);

        // 3. Extract manifest IDs
        const ids = await extractManifestIds(tempDir);

        if (!ids.section_id) {
            throw new Error('Could not extract required section_id from backup files.');
        }

        const assignmentDetails = [];

        // 4. Modify existing assignments by moduleId
        for (const info of assignments) {
            if (!info?.moduleId || !info.name ||
                typeof info.due_ts !== 'number' || typeof info.cutoff_ts !== 'number') {
                continue;
            }

            const assignXmlPath = path.join(tempDir, 'activities', `assign_${info.moduleId}`, 'assign.xml');
            await modifyAssignment(assignXmlPath, info.name, info.due_ts, info.cutoff_ts, info.activation_ts);

            assignmentDetails.push({
                name: info.name,
                moduleid: info.moduleId,
            });
        }

        // 5. Update manifest files
        const sectionXmlPath = path.join(tempDir, 'sections', `section_${ids.section_id}`, 'section.xml');
        await updateSectionXml(sectionXmlPath, ids.existing_module_ids, sectionTitle);

        const moodleBackupXmlPath = path.join(tempDir, 'moodle_backup.xml');
        const newBackupId = crypto.randomUUID().replace(/-/g, '');
        await updateMoodleBackupXml(
            moodleBackupXmlPath,
            outputFilename,
            ids.original_backup_id,
            newBackupId,
            assignmentDetails,
            ids.section_id,
            sectionTitle,
            targetStartTimestamp
        );

        // 6. Truncate log file (ignore if it doesn't exist)
        const logFilePath = path.join(tempDir, 'moodle_backup.log');
        await fs.writeFile(logFilePath, '', 'utf8').catch(() => {});

        // 7. Re-pack archive
        await createMbz(tempDir, outputMbzPath);

    } finally {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (cleanupErr) {
            // Ignore cleanup errors
        }
    }
}

module.exports = {
    parseAssignmentsFromMbz,
    modifyMoodleBackup,
};
