const fs = require('fs').promises;
const path = require('path');

/**
 * Recursively deletes files and directories starting with '.' in basePath.
 * @param {string} basePath - Directory to clean
 */
async function deleteDotfiles(basePath) {
    let deletedCount = 0;
    async function walk(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.name.startsWith('.')) {
                try {
                    await fs.rm(fullPath, { recursive: true, force: true });
                    deletedCount++;
                } catch (err) {
                    // Ignore errors
                }
            } else if (entry.isDirectory()) {
                await walk(fullPath);
            }
        }
    }
    await walk(basePath);
    return deletedCount;
}

module.exports = {
    deleteDotfiles,
};
