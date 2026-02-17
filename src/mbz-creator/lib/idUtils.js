const fs = require('fs').promises;
const path = require('path');

/**
 * Extracts only the essential IDs needed for modifying an existing backup.
 * No longer scans for max IDs needed for creating new assignments.
 * @param {string} basePath - Path to extracted MBZ root
 * @returns {Promise<Object>} { section_id, existing_module_ids, original_backup_id }
 */
async function extractManifestIds(basePath) {
    const ids = {
        section_id: null,
        existing_module_ids: [],
        original_backup_id: null,
    };

    const moodleBackupPath = path.join(basePath, 'moodle_backup.xml');
    try {
        const content = await fs.readFile(moodleBackupPath, 'utf8');
        ids.existing_module_ids = [...content.matchAll(/<moduleid>(\d+)<\/moduleid>/g)].map(m => m[1]);
        const sectionMatch = content.match(/<sectionid>(\d+)<\/sectionid>/);
        if (sectionMatch) ids.section_id = sectionMatch[1];
        const backupIdMatch = content.match(/<detail backup_id="([a-f0-9]+)">/);
        if (backupIdMatch) ids.original_backup_id = backupIdMatch[1];
    } catch (e) {
        // File may not exist
    }

    return ids;
}

module.exports = {
    extractManifestIds,
};
