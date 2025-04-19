const fs = require('fs').promises;
const path = require('path');

/**
 * Updates the sequence in section.xml and optionally the section title.
 * @param {string} sectionXmlPath - Path to section.xml
 * @param {Array<string|number>} allModuleIds - List of module IDs
 * @param {string} [sectionTitle] - Optional new section title
 * @returns {Promise<boolean>} true if changes made or up-to-date, false if error
 */
async function updateSectionXml(sectionXmlPath, allModuleIds, sectionTitle) {
  try {
    let content = await fs.readFile(sectionXmlPath, 'utf8');
    const originalContent = content;
    // Update sequence
    const sequenceStr = allModuleIds.join(',');
    let changed = false;
    let newContent = content.replace(/(<sequence>)(.*?)(<\/sequence>)/, (m, p1, _old, p3) => {
      changed = true;
      return `${p1}${sequenceStr}${p3}`;
    });
    // Update section title if provided
    if (sectionTitle) {
      // Match the Python script: Only update the <name> tag
      const nameRegex = /(<name>)(.*?)(<\/name>)/;
      const originalSectionTitle = content.match(nameRegex)?.[2]; // Get original title if tag exists

      if (content.match(nameRegex)) { // Check if the tag exists
         // Only replace if the new title is actually different
         if (originalSectionTitle !== sectionTitle) {
             newContent = newContent.replace(nameRegex, (m, p1, _old, p3) => {
               changed = true;
               return `${p1}${sectionTitle}${p3}`;
             });
         } else {
             // Title is already correct, ensure 'changed' remains true if sequence changed
             // but don't mark title as changed if it wasn't.
             console.log('  Section title already matches, no change needed.');
         }
      } else {
          console.log(`  Warning: Could not find <name> tag in ${sectionXmlPath} to update section title.`);
          // Decide if this should be an error or just a warning like in Python
          // For now, just warn and continue.
      }
    }
    if (newContent !== originalContent) {
      await fs.writeFile(sectionXmlPath, newContent, 'utf8');
      return true;
    } else {
      return true; // Up-to-date
    }
  } catch (e) {
    return false;
  }
}

/**
 * Modifies moodle_backup.xml: filename, backup_id, startdate, activities, settings, etc.
 * Closely follows the Python logic.
 */
async function updateMoodleBackupXml(
  xmlPath,
  outputFilename,
  originalBackupId,
  newBackupId,
  allAssignmentDetails,
  sectionId,
  addedModuleIds,
  sectionTitle,
  targetStartTimestamp
) {
  try {
    let content = await fs.readFile(xmlPath, 'utf8');
    let changesMade = false;
    // 1. <information><name>
    let newContent = content.replace(/(<information>.*?<name>)(.*?)(<\/name>)/s, `$1${outputFilename}$3`);
    if (newContent !== content) { changesMade = true; content = newContent; }
    // 2. <setting> filename
    newContent = content.replace(/(<setting>\s*<level>root<\/level>\s*<name>filename<\/name>\s*<value>)(.*?)(<\/value>\s*<\/setting>)/s, `$1${outputFilename}$3`);
    if (newContent !== content) { changesMade = true; content = newContent; }
    // 3. backup_id
    if (originalBackupId) {
      newContent = content.replace(new RegExp(`backup_id="${originalBackupId}"`), `backup_id="${newBackupId}"`);
      if (newContent !== content) { changesMade = true; content = newContent; }
    }
    // 3.5. section title in <sections>
    if (sectionTitle && sectionId) {
      // For moodle_backup.xml, the format is <title>...</title>
      const sectionTitlePattern = new RegExp(
        `(<section>\\s*<sectionid>${sectionId}<\\/sectionid>\\s*<title>)(.*?)(<\\/title>)`,
        's'
      );
      newContent = content.replace(sectionTitlePattern, `$1${sectionTitle}$3`);
      if (newContent !== content) { changesMade = true; content = newContent; }
    }
    // 4. <activities> block
    const activitiesMatch = content.match(/(<activities>)([\s\S]*?)(<\/activities>)/);
    if (activitiesMatch) {
      const leadingIndent = (activitiesMatch[2].match(/^(\s*)<activity>/m) || [null, '          '])[1];
      const activityTemplateMatch = activitiesMatch[2].match(/(<activity>[\s\S]*?<\/activity>)/);
      if (activityTemplateMatch) {
        let newActivitiesContent = '\n';
        for (const details of allAssignmentDetails) {
          let newEntry = activityTemplateMatch[1];
          const safeTitle = details.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          newEntry = newEntry.replace(/<moduleid>\d+<\/moduleid>/, `<moduleid>${details.moduleid}</moduleid>`);
          newEntry = newEntry.replace(/<sectionid>\d+<\/sectionid>/, `<sectionid>${sectionId}</sectionid>`);
          newEntry = newEntry.replace(/<title>.*?<\/title>/, `<title>${safeTitle}</title>`);
          newEntry = newEntry.replace(/<directory>.*?<\/directory>/, `<directory>activities/assign_${details.moduleid}</directory>`);
          newActivitiesContent += `${leadingIndent}${newEntry}\n`;
        }
        const trailingIndent = (activitiesMatch[0].match(/(\s*)<\/activities>$/) || [null, '        '])[1];
        const newActivitiesBlock = activitiesMatch[1] + newActivitiesContent + trailingIndent + activitiesMatch[3];
        content = content.replace(activitiesMatch[0], newActivitiesBlock);
        changesMade = true;
      }
    }
    // 5. Add new <setting> blocks for added activities
    if (addedModuleIds && addedModuleIds.length) {
      let lastSettingMatch;
      for (const match of content.matchAll(/(\s*)<setting>[\s\S]*?<\/setting>/g)) {
        lastSettingMatch = match;
      }
      if (lastSettingMatch) {
        const indent = lastSettingMatch[1];
        const insertionPoint = lastSettingMatch.index + lastSettingMatch[0].length;
        let newSettingsText = '\n';
        for (const modId of addedModuleIds) {
          const activityName = `assign_${modId}`;
          newSettingsText +=
            `${indent}<setting>\n` +
            `${indent}  <level>activity</level>\n` +
            `${indent}  <activity>${activityName}</activity>\n` +
            `${indent}  <name>${activityName}_included</name>\n` +
            `${indent}  <value>1</value>\n` +
            `${indent}</setting>\n` +
            `${indent}<setting>\n` +
            `${indent}  <level>activity</level>\n` +
            `${indent}  <activity>${activityName}</activity>\n` +
            `${indent}  <name>${activityName}_userinfo</name>\n` +
            `${indent}  <value>0</value>\n` +
            `${indent}</setting>\n`;
        }
        content = content.slice(0, insertionPoint) + newSettingsText + content.slice(insertionPoint);
        changesMade = true;
      }
    }
    // 6. Update course start date if provided
    if (typeof targetStartTimestamp === 'number') {
      let changesMadeForDate = false;
      // <original_course_startdate>
      let newContent6 = content.replace(/(<original_course_startdate>)\d+(<\/original_course_startdate>)/, `$1${targetStartTimestamp}$2`);
      if (newContent6 !== content) { content = newContent6; changesMade = true; changesMadeForDate = true; }
      // <details><startdate>
      newContent6 = content.replace(/(<details>[\s\S]*?<startdate>)\d+(<\/startdate>[\s\S]*?<\/details>)/, `$1${targetStartTimestamp}$2`);
      if (newContent6 !== content) { content = newContent6; changesMade = true; changesMadeForDate = true; }
      // <course><startdate>
      newContent6 = content.replace(/(<course\b[^>]*>[\s\S]*?<startdate>)\d+(<\/startdate>[\s\S]*?<\/course>)/, `$1${targetStartTimestamp}$2`);
      if (newContent6 !== content) { content = newContent6; changesMade = true; changesMadeForDate = true; }
      // Fallback: global <startdate>
      if (!changesMadeForDate) {
        newContent6 = content.replace(/(<startdate>)\d+(<\/startdate>)/, `$1${targetStartTimestamp}$2`);
        if (newContent6 !== content) { content = newContent6; changesMade = true; }
      }
    }
    // Write changes if any
    if (changesMade) {
      await fs.writeFile(xmlPath, content, 'utf8');
      return true;
    } else {
      return false;
    }
  } catch (e) {
    return false;
  }
}

module.exports = {
  updateSectionXml,
  updateMoodleBackupXml,
}; 