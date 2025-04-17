// Handles the generation of the new MBZ file with batch assignments.

const AdmZip = require('adm-zip');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const fs = require('fs').promises; // Use promises API for async operations
const path = require('path');
const { dateTimeToTimestamp } = require('./utils'); // Use our utility

// XML options - consistent with parser
const xmlParserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
  parseTagValue: false,       // Keep tag values as strings
  // Important for builder: preserve order for Moodle
  preserveOrder: true,
};
const xmlBuilderOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true, // Pretty print for readability
  suppressEmptyNode: true,
  // Important for builder: preserve order for Moodle
  preserveOrder: true,
};

/**
 * Finds the highest numeric value for a specific ID property within nested
 * XML data structures (parsed by fast-xml-parser).
 *
 * @param {object|Array} data - The parsed XML data.
 * @param {string} idPropertyName - The name of the ID property (e.g., 'moduleid', '@_id').
 * @returns {number} The highest ID found (or 0 if none).
 */
function findHighestId(data, idPropertyName) {
  let highest = 0;

  function traverse(obj) {
    if (!obj) return;

    if (Array.isArray(obj)) {
      obj.forEach(item => traverse(item));
    } else if (typeof obj === 'object') {
      // Check direct property or attribute
      const idValue = obj[idPropertyName];
      if (idValue && typeof idValue === 'number') {
        highest = Math.max(highest, idValue);
      }
      // Check properties potentially holding the ID (e.g., within 'activity' tag)
      if (obj[':@'] && obj[':@'][idPropertyName] && typeof obj[':@'][idPropertyName] === 'number') {
        highest = Math.max(highest, obj[':@'][idPropertyName]);
      }

      // Recursively traverse children
      Object.keys(obj).forEach(key => {
        // Skip the attribute container itself
        if (key !== ':@') {
          traverse(obj[key]);
        }
      });
    }
  }

  traverse(data);
  return highest;
}

/**
 * Generates a new MBZ file by duplicating and modifying template assignment files.
 *
 * @param {object} options - Generation options.
 * @param {object} options.templateInfo - Analysis result from the parser.
 * @param {Date[]} options.selectedDates - Sorted array of Date objects for deadlines.
 * @param {number} options.timeHour - Hour for deadlines.
 * @param {number} options.timeMinute - Minute for deadlines.
 * @param {string} options.namePrefix - Prefix for assignment names.
 * @param {string} options.outputPath - Path to write the new MBZ file.
 * @returns {Promise<object>} Result object { numAssignments: number, outputPath: string }.
 */
async function generateBatchMbz({ templateInfo, selectedDates, timeHour, timeMinute, namePrefix, outputPath }) {
  const parser = new XMLParser(xmlParserOptions);
  const builder = new XMLBuilder(xmlBuilderOptions);

  // 1. Load and parse core XML files
  const backupXmlContent = await fs.readFile(templateInfo.paths.backupXml, 'utf8');
  const backupData = parser.parse(backupXmlContent);

  const assignXmlContent = await fs.readFile(templateInfo.paths.templateAssignXml, 'utf8');
  const assignData = parser.parse(assignXmlContent);

  const moduleXmlContent = await fs.readFile(templateInfo.paths.templateModuleXml, 'utf8');
  const moduleData = parser.parse(moduleXmlContent);

  let sectionData = null;
  if (templateInfo.paths.sectionXml && await fs.stat(templateInfo.paths.sectionXml).then(() => true).catch(() => false)) {
    const sectionXmlContent = await fs.readFile(templateInfo.paths.sectionXml, 'utf8');
    sectionData = parser.parse(sectionXmlContent);
  } else {
    console.warn('Section XML not found or accessible, sequence will not be updated.');
  }

  // Ensure backupData structure is navigable
  const backupInfo = backupData?.[0]?.moodle_backup?.[0]?.information?.[0];
  if (!backupInfo || !backupInfo.contents?.[0]?.activities?.[0]?.activity || !backupInfo.settings?.[0]?.setting) {
      throw new Error('Invalid moodle_backup.xml structure.');
  }
  // Make sure activities and settings are arrays for easier manipulation
  if (!Array.isArray(backupInfo.contents[0].activities[0].activity)) {
    backupInfo.contents[0].activities[0].activity = [backupInfo.contents[0].activities[0].activity];
  }
  if (!Array.isArray(backupInfo.settings[0].setting)) {
    backupInfo.settings[0].setting = [backupInfo.settings[0].setting];
  }

  // 2. Find highest existing IDs to start incrementing from
  // Check backupData, assignData, and moduleData for relevant IDs
  const highestModuleId = findHighestId([backupData, moduleData], 'moduleid');
  const highestActivityId = findHighestId([backupData, assignData], '@_id'); // Check attribute ID in assign.xml
  const highestContextId = findHighestId([backupData, assignData], '@_contextid'); // Check attribute contextid

  console.log(`Highest IDs found: Module=${highestModuleId}, Activity=${highestActivityId}, Context=${highestContextId}`);

  // 3. Process each selected date to create a new assignment
  const newModuleIds = [];
  const newActivitiesBackupEntries = [];
  const newSettingsBackupEntries = [];

  // Sort dates just in case they aren't already (should be by UI)
  selectedDates.sort((a, b) => a.getTime() - b.getTime());

  for (let i = 0; i < selectedDates.length; i++) {
    const pageNumber = i + 1;
    const currentTimestamp = Math.floor(Date.now() / 1000);

    // Calculate timestamps for this assignment
    const dueDate = selectedDates[i];
    const dueDateTs = dateTimeToTimestamp(dueDate, timeHour, timeMinute);
    const availabilityTs = (i > 0)
      ? dateTimeToTimestamp(selectedDates[i - 1], timeHour, timeMinute) // Previous due date
      : currentTimestamp; // Or now for the first one

    // Generate unique IDs
    const newModuleId = highestModuleId + pageNumber;
    const newActivityId = highestActivityId + pageNumber;
    const newContextId = highestContextId + pageNumber;
    const newAssignDirName = `assign_${newModuleId}`;
    const newAssignDirPath = path.join(templateInfo.paths.activitiesDir, newAssignDirName);
    const newAssignmentName = `${namePrefix} ${pageNumber}`;

    newModuleIds.push(newModuleId);

    // a. Create new activity directory
    await fs.mkdir(newAssignDirPath, { recursive: true });

    // b. Create and write modified assign.xml
    // Deep clone is essential here!
    const newAssignData = JSON.parse(JSON.stringify(assignData));
    const activityNode = newAssignData.find(node => node.activity);
    const assignNode = activityNode?.activity.find(node => node.assign);

    if (!activityNode || !assignNode) throw new Error('Invalid assign.xml structure after parse');

    // Update IDs and core properties
    activityNode[':@']['@_id'] = newActivityId;
    activityNode[':@']['@_moduleid'] = newModuleId;
    activityNode[':@']['@_contextid'] = newContextId;
    assignNode.assign.find(prop => prop.name).name[0]['#text'] = newAssignmentName;
    assignNode.assign.find(prop => prop.duedate).duedate[0]['#text'] = dueDateTs;
    assignNode.assign.find(prop => prop.cutoffdate).cutoffdate[0]['#text'] = dueDateTs; // Same as due date
    assignNode.assign.find(prop => prop.allowsubmissionsfromdate).allowsubmissionsfromdate[0]['#text'] = availabilityTs;
    assignNode.assign.find(prop => prop.timemodified).timemodified[0]['#text'] = currentTimestamp;

    await fs.writeFile(path.join(newAssignDirPath, 'assign.xml'), builder.build(newAssignData));

    // c. Create and write modified module.xml
    const newModuleData = JSON.parse(JSON.stringify(moduleData));
    const moduleNode = newModuleData.find(node => node.module);
    if (!moduleNode) throw new Error('Invalid module.xml structure after parse');

    moduleNode[':@']['@_id'] = newModuleId;
    moduleNode.module.find(prop => prop.added).added[0]['#text'] = currentTimestamp;
    // Ensure section ID is correct (should be from templateInfo)
    moduleNode.module.find(prop => prop.sectionid).sectionid[0]['#text'] = templateInfo.sectionId;

    await fs.writeFile(path.join(newAssignDirPath, 'module.xml'), builder.build(newModuleData));

    // d. Copy other files from template activity directory (e.g., grades.xml, etc.)
    const templateFiles = await fs.readdir(templateInfo.paths.templateAssignDir);
    for (const file of templateFiles) {
      if (file !== 'assign.xml' && file !== 'module.xml') {
        await fs.copyFile(
          path.join(templateInfo.paths.templateAssignDir, file),
          path.join(newAssignDirPath, file)
        );
      }
    }

    // e. Prepare entries for moodle_backup.xml
    newActivitiesBackupEntries.push({
        activity: [{
            moduleid: [{ '#text': newModuleId }],
            sectionid: [{ '#text': templateInfo.sectionId }],
            modulename: [{ '#text': 'assign' }],
            title: [{ '#text': newAssignmentName }],
            directory: [{ '#text': `activities/${newAssignDirName}` }],
            // insubsection might be needed depending on Moodle version
            insubsection: [{ '#text': '' }]
        }]
    });

    newSettingsBackupEntries.push(
      { setting: [{ level: [{ '#text': 'activity' }], activity: [{ '#text': newAssignDirName }], name: [{ '#text': `${newAssignDirName}_included` }], value: [{ '#text': 1 }] }] },
      { setting: [{ level: [{ '#text': 'activity' }], activity: [{ '#text': newAssignDirName }], name: [{ '#text': `${newAssignDirName}_userinfo` }], value: [{ '#text': 0 }] }] }
    );

    console.log(`Generated assignment ${pageNumber}: ${newAssignmentName} (ModuleID: ${newModuleId})`);
  }

  // 4. Update moodle_backup.xml data structure
  backupInfo.contents[0].activities[0].activity.push(...newActivitiesBackupEntries);
  backupInfo.settings[0].setting.push(...newSettingsBackupEntries);

  // 5. Update section.xml data structure (if available)
  if (sectionData) {
    const sectionNode = sectionData.find(node => node.section);
    if (sectionNode) {
        const sequenceNode = sectionNode.section.find(prop => prop.sequence);
        if (sequenceNode) {
            const currentSequence = sequenceNode.sequence[0]['#text'] || '';
            const newSequence = currentSequence ? `${currentSequence},${newModuleIds.join(',')}` : newModuleIds.join(',');
            sequenceNode.sequence[0]['#text'] = newSequence;
        } else {
            // Add sequence if it doesn't exist
            sectionNode.section.push({ sequence: [{ '#text': newModuleIds.join(',') }] });
        }
        // Write updated section.xml
        await fs.writeFile(templateInfo.paths.sectionXml, builder.build(sectionData));
    } else {
        console.warn('Could not find <section> node in parsed section.xml data.');
    }
  } else {
      console.log('Skipping section sequence update as section.xml was not found or parsed.');
  }

  // 6. Write updated moodle_backup.xml
  await fs.writeFile(templateInfo.paths.backupXml, builder.build(backupData));

  // 7. Create the new MBZ zip archive
  console.log(`Creating new MBZ archive at: ${outputPath}`);
  const newZip = new AdmZip();

  // Add all files and directories from the temp directory root
  newZip.addLocalFolder(templateInfo.tempDir, ''/* target path within zip */);

  // Write the zip file
  await newZip.writeZipPromise(outputPath);
  console.log('MBZ archive created successfully.');

  return {
    numAssignments: selectedDates.length,
    outputPath
  };
}

module.exports = { generateBatchMbz }; 