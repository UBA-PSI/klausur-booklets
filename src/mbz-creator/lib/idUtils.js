const fs = require('fs').promises;
const path = require('path');

/**
 * Find all matches for a pattern and return the maximum ID found.
 * @param {RegExp} pattern - Regex with a capture group for the ID
 * @param {string} text - Text to search
 * @param {function} castTo - Function to cast the match (default: Number)
 * @returns {number} Maximum ID found, or 0 if none
 */
function findMaxId(pattern, text, castTo = Number) {
  const matches = [...text.matchAll(pattern)];
  const ids = matches.map(m => castTo(m[1]));
  return ids.length ? Math.max(...ids) : 0;
}

/**
 * Find the first match for a pattern and return the ID.
 * @param {RegExp} pattern - Regex with a capture group for the ID
 * @param {string} text - Text to search
 * @param {function} castTo - Function to cast the match (default: Number)
 * @returns {number|null} First ID found, or null if not found
 */
function findFirstId(pattern, text, castTo = Number) {
  const match = pattern.exec(text);
  return match ? castTo(match[1]) : null;
}

/**
 * Extracts maximum IDs and constants from existing backup files.
 * @param {string} basePath - Path to extracted MBZ root
 * @returns {Promise<Object>} IDs and related info
 */
async function extractIds(basePath) {
  const ids = {
    max_module_id: 0,
    max_activity_id: 0,
    max_plugin_config_id: 0,
    max_grade_item_id: 0,
    context_id: null,
    max_context_id: 0,
    max_grading_area_id: 0,
    max_sortorder: 0,
    section_id: null,
    existing_module_ids: [],
    existing_activity_ids: [],
    original_backup_id: null,
  };

  // 1. moodle_backup.xml
  const moodleBackupPath = path.join(basePath, 'moodle_backup.xml');
  try {
    const content = await fs.readFile(moodleBackupPath, 'utf8');
    ids.max_module_id = findMaxId(/<moduleid>(\d+)<\/moduleid>/g, content);
    ids.existing_module_ids = [...content.matchAll(/<moduleid>(\d+)<\/moduleid>/g)].map(m => m[1]);
    ids.section_id = findFirstId(/<sectionid>(\d+)<\/sectionid>/, content);
    const backupIdMatch = content.match(/<detail backup_id="([a-f0-9]+)">/);
    if (backupIdMatch) ids.original_backup_id = backupIdMatch[1];
  } catch (e) {
    // File may not exist, that's fine for now
  }

  // 2. assign.xml files
  const activityDir = path.join(basePath, 'activities');
  let maxActIdOverall = 0;
  let maxPluginIdOverall = 0;
  let maxContextIdOverall = 0;
  let existingActIdsTemp = [];
  try {
    const activityFolders = await fs.readdir(activityDir, { withFileTypes: true });
    for (const folder of activityFolders) {
      if (!folder.isDirectory() || !folder.name.startsWith('assign_')) continue;
      const assignXml = path.join(activityDir, folder.name, 'assign.xml');
      try {
        const content = await fs.readFile(assignXml, 'utf8');
        const actId = findMaxId(/<(?:activity|assign) id="(\d+)">/g, content);
        maxActIdOverall = Math.max(maxActIdOverall, actId);
        existingActIdsTemp.push(actId);
        const plugId = findMaxId(/<plugin_config id="(\d+)">/g, content);
        maxPluginIdOverall = Math.max(maxPluginIdOverall, plugId);
        const contextId = findFirstId(/<activity.*?contextid="(\d+)".*?>/, content);
        if (contextId) {
          maxContextIdOverall = Math.max(maxContextIdOverall, contextId);
          if (ids.context_id === null) ids.context_id = contextId;
        }
      } catch {}
    }
  } catch {}
  ids.max_activity_id = maxActIdOverall;
  ids.existing_activity_ids = Array.from(new Set(existingActIdsTemp)).sort();
  ids.max_plugin_config_id = maxPluginIdOverall;
  ids.max_context_id = maxContextIdOverall;

  // 3. inforef.xml files
  let maxGradeIdOverall = 0;
  try {
    const activityFolders = await fs.readdir(activityDir, { withFileTypes: true });
    for (const folder of activityFolders) {
      if (!folder.isDirectory() || !folder.name.startsWith('assign_')) continue;
      const inforefXml = path.join(activityDir, folder.name, 'inforef.xml');
      try {
        const content = await fs.readFile(inforefXml, 'utf8');
        const gradeId = findMaxId(/<grade_item>\s*<id>(\d+)<\/id>\s*<\/grade_item>/g, content);
        maxGradeIdOverall = Math.max(maxGradeIdOverall, gradeId);
      } catch {}
    }
  } catch {}
  ids.max_grade_item_id = maxGradeIdOverall;

  // 4. grading.xml files
  let maxGradingAreaIdOverall = 0;
  try {
    const activityFolders = await fs.readdir(activityDir, { withFileTypes: true });
    for (const folder of activityFolders) {
      if (!folder.isDirectory() || !folder.name.startsWith('assign_')) continue;
      const gradingXml = path.join(activityDir, folder.name, 'grading.xml');
      try {
        const content = await fs.readFile(gradingXml, 'utf8');
        const areaId = findMaxId(/<area id="(\d+)">/g, content);
        maxGradingAreaIdOverall = Math.max(maxGradingAreaIdOverall, areaId);
      } catch {}
    }
  } catch {}
  ids.max_grading_area_id = maxGradingAreaIdOverall;

  // 5. grades.xml files
  let maxSortorderOverall = 0;
  try {
    const activityFolders = await fs.readdir(activityDir, { withFileTypes: true });
    for (const folder of activityFolders) {
      if (!folder.isDirectory() || !folder.name.startsWith('assign_')) continue;
      const gradesXml = path.join(activityDir, folder.name, 'grades.xml');
      try {
        const content = await fs.readFile(gradesXml, 'utf8');
        const sortorder = findMaxId(/<sortorder>(\d+)<\/sortorder>/g, content);
        maxSortorderOverall = Math.max(maxSortorderOverall, sortorder);
      } catch {}
    }
  } catch {}
  ids.max_sortorder = maxSortorderOverall;

  return ids;
}

module.exports = {
  findMaxId,
  findFirstId,
  extractIds,
}; 