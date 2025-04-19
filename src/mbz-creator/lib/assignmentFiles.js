const fs = require('fs').promises;
const path = require('path');

/**
 * Modifies name, duedate, cutoffdate, and allowsubmissionsfromdate in an existing assign.xml.
 * @param {string} filePath - Path to assign.xml
 * @param {string} newName
 * @param {number} newDueTs
 * @param {number} newCutoffTs
 * @param {number} [newActivationTs] (optional)
 * @returns {Promise<boolean>} true if modified, false otherwise
 */
async function modifyAssignment(filePath, newName, newDueTs, newCutoffTs, newActivationTs) {
  let modified = false;
  try {
    let content = await fs.readFile(filePath, 'utf8');
    const originalContent = content;

    // Modify <name>
    content = content.replace(/(<name>)(.*?)(<\/name>)/, `$1${newName}$3`);
    // Modify <duedate>
    content = content.replace(/(<duedate>)(.*?)(<\/duedate>)/, `$1${newDueTs}$3`);
    // Modify <cutoffdate>
    content = content.replace(/(<cutoffdate>)(.*?)(<\/cutoffdate>)/, `$1${newCutoffTs}$3`);
    // Modify <allowsubmissionsfromdate> if provided
    if (typeof newActivationTs === 'number') {
      content = content.replace(/(<allowsubmissionsfromdate>)(.*?)(<\/allowsubmissionsfromdate>)/, `$1${newActivationTs}$3`);
    }

    if (content !== originalContent) {
      await fs.writeFile(filePath, content, 'utf8');
      modified = true;
    }
  } catch (e) {
    // Could log error
  }
  return modified;
}

/**
 * Creates directory and files for a new assignment.
 * Closely follows the Python logic.
 */
async function createNewAssignmentFiles(
  basePath,
  assignTemplateContent,
  inforefTemplateContent,
  newModuleId,
  newActivityId,
  startPluginConfigId,
  newGradeItemId,
  newContextId,
  newGradingAreaId,
  newSortorder,
  assignmentInfo,
  sectionId
) {
  const assignDir = path.join(basePath, 'activities', `assign_${newModuleId}`);
  await fs.mkdir(assignDir, { recursive: true });
  let currentPluginConfigId = startPluginConfigId;

  // 1. assign.xml
  let assignContent = assignTemplateContent;
  assignContent = assignContent.replace(/<activity id="\d+"/, `<activity id="${newActivityId}"`);
  assignContent = assignContent.replace(/moduleid="\d+"/, `moduleid="${newModuleId}"`);
  assignContent = assignContent.replace(/contextid="\d+"/, `contextid="${newContextId}"`);
  assignContent = assignContent.replace(/<assign id="\d+">/, `<assign id="${newActivityId}">`);
  assignContent = assignContent.replace(/<name>.*?<\/name>/, `<name>${assignmentInfo.name}</name>`);
  assignContent = assignContent.replace(/<duedate>\d+<\/duedate>/, `<duedate>${assignmentInfo.due_ts}</duedate>`);
  assignContent = assignContent.replace(/<cutoffdate>\d+<\/cutoffdate>/, `<cutoffdate>${assignmentInfo.cutoff_ts}</cutoffdate>`);
  if ('activation_ts' in assignmentInfo) {
    assignContent = assignContent.replace(/<allowsubmissionsfromdate>\d+<\/allowsubmissionsfromdate>/, `<allowsubmissionsfromdate>${assignmentInfo.activation_ts}</allowsubmissionsfromdate>`);
  }
  // Replace plugin_config IDs sequentially
  assignContent = assignContent.replace(/<plugin_config id="\d+">/g, () => `<plugin_config id="${currentPluginConfigId++}">`);
  await fs.writeFile(path.join(assignDir, 'assign.xml'), assignContent, 'utf8');

  // 2. inforef.xml
  let inforefContent = inforefTemplateContent.replace(/<id>\d+<\/id>/, `<id>${newGradeItemId}</id>`);
  await fs.writeFile(path.join(assignDir, 'inforef.xml'), inforefContent, 'utf8');

  // 3. module.xml
  const nowTs = Math.floor(Date.now() / 1000);
  const moduleContent = `<?xml version="1.0" encoding="UTF-8"?>\n<module id="${newModuleId}" version="2024100700">\n  <modulename>assign</modulename>\n  <sectionid>${sectionId}</sectionid>\n  <sectionnumber>1</sectionnumber>\n  <idnumber></idnumber>\n  <added>${nowTs}</added>\n  <score>0</score>\n  <indent>0</indent>\n  <visible>1</visible>\n  <visibleoncoursepage>1</visibleoncoursepage>\n  <visibleold>1</visibleold>\n  <groupmode>0</groupmode>\n  <groupingid>0</groupingid>\n  <completion>0</completion>\n  <completiongradeitemnumber>$@NULL@$</completiongradeitemnumber>\n  <completionpassgrade>0</completionpassgrade>\n  <completionview>0</completionview>\n  <completionexpected>0</completionexpected>\n  <availability>$@NULL@$</availability>\n  <showdescription>0</showdescription>\n  <downloadcontent>1</downloadcontent>\n  <lang></lang>\n  <plugin_plagiarism_turnitinsim_module>\n    <turnitinsim_mods>\n    </turnitinsim_mods>\n  </plugin_plagiarism_turnitinsim_module>\n  <tags>\n  </tags>\n</module>`;
  await fs.writeFile(path.join(assignDir, 'module.xml'), moduleContent, 'utf8');

  // 4. grades.xml
  const gradesContent = `<?xml version="1.0" encoding="UTF-8"?>\n<activity_gradebook>\n  <grade_items>\n    <grade_item id="${newGradeItemId}">\n      <categoryid>27919</categoryid>\n      <itemname>${assignmentInfo.name}</itemname>\n      <itemtype>mod</itemtype>\n      <itemmodule>assign</itemmodule>\n      <iteminstance>${newActivityId}</iteminstance>\n      <itemnumber>0</itemnumber>\n      <iteminfo>$@NULL@$</iteminfo>\n      <idnumber></idnumber>\n      <calculation>$@NULL@$</calculation>\n      <gradetype>1</gradetype>\n      <grademax>100.00000</grademax>\n      <grademin>0.00000</grademin>\n      <scaleid>$@NULL@$</scaleid>\n      <outcomeid>$@NULL@$</outcomeid>\n      <gradepass>0.00000</gradepass>\n      <multfactor>1.00000</multfactor>\n      <plusfactor>0.00000</plusfactor>\n      <aggregationcoef>0.00000</aggregationcoef>\n      <aggregationcoef2>0.00000</aggregationcoef2>\n      <weightoverride>0</weightoverride>\n      <sortorder>${newSortorder}</sortorder>\n      <display>0</display>\n      <decimals>$@NULL@$</decimals>\n      <hidden>0</hidden>\n      <locked>0</locked>\n      <locktime>0</locktime>\n      <needsupdate>0</needsupdate>\n      <timecreated>${nowTs}</timecreated>\n      <timemodified>${nowTs}</timemodified>\n      <grade_grades>\n      </grade_grades>\n    </grade_item>\n  </grade_items>\n  <grade_letters>\n  </grade_letters>\n</activity_gradebook>`;
  await fs.writeFile(path.join(assignDir, 'grades.xml'), gradesContent, 'utf8');

  // 5. grading.xml
  const gradingContent = `<?xml version="1.0" encoding="UTF-8"?>\n<areas>\n  <area id="${newGradingAreaId}">\n    <areaname>submissions</areaname>\n    <activemethod>$@NULL@$</activemethod>\n    <definitions>\n    </definitions>\n  </area>\n</areas>`;
  await fs.writeFile(path.join(assignDir, 'grading.xml'), gradingContent, 'utf8');

  // 6. grade_history.xml
  const gradeHistoryContent = `<?xml version="1.0" encoding="UTF-8"?>\n<grade_history>\n  <grade_grades>\n  </grade_grades>\n</grade_history>`;
  await fs.writeFile(path.join(assignDir, 'grade_history.xml'), gradeHistoryContent, 'utf8');

  // 7. roles.xml
  const rolesContent = `<?xml version="1.0" encoding="UTF-8"?>\n<roles>\n  <role_overrides>\n  </role_overrides>\n  <role_assignments>\n  </role_assignments>\n</roles>`;
  await fs.writeFile(path.join(assignDir, 'roles.xml'), rolesContent, 'utf8');

  return currentPluginConfigId;
}

module.exports = {
  modifyAssignment,
  createNewAssignmentFiles,
}; 