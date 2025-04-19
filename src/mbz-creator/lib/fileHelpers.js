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
      if (entry.name === '.' || entry.name === '..') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.name.startsWith('.')) {
        try {
          const stat = await fs.lstat(fullPath);
          if (stat.isDirectory()) {
            await fs.rm(fullPath, { recursive: true, force: true });
          } else {
            await fs.unlink(fullPath);
          }
          deletedCount++;
        } catch (err) {
          // Ignore errors for now, could log if needed
        }
      } else if (entry.isDirectory()) {
        await walk(fullPath);
      }
    }
  }
  await walk(basePath);
  return deletedCount;
}

/**
 * Finds the first assign_XXX directory and reads assign.xml and inforef.xml as templates.
 * @param {string} basePath - Path to the extracted MBZ root directory.
 * @returns {Promise<{assignTemplate: string, inforefTemplate: string}|null>} Templates or null if not found.
 */
async function findAssignmentTemplates(basePath) {
  const activityDir = path.join(basePath, 'activities');
  try {
    const entries = await fs.readdir(activityDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('assign_')) {
        const assignDirPath = path.join(activityDir, entry.name);
        const assignXmlPath = path.join(assignDirPath, 'assign.xml');
        const inforefXmlPath = path.join(assignDirPath, 'inforef.xml');
        try {
          const assignTemplate = await fs.readFile(assignXmlPath, 'utf8');
          const inforefTemplate = await fs.readFile(inforefXmlPath, 'utf8');
          return { assignTemplate, inforefTemplate };
        } catch (readErr) {
          // Couldn't read templates from this directory, continue searching
          console.warn(`Warning: Could not read templates from ${entry.name}: ${readErr.message}`);
        }
      }
    }
    // If loop finishes without finding templates
    console.error('Error: No assign_ directory found containing assign.xml and inforef.xml');
    return null;
  } catch (err) {
    console.error(`Error accessing activities directory ${activityDir}: ${err.message}`);
    return null;
  }
}

module.exports = {
  deleteDotfiles,
  findAssignmentTemplates,
}; 