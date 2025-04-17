const { extractMbz } = require('../lib/archive');
const { createNewAssignmentFiles } = require('../lib/assignmentFiles');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { existsSync } = require('fs');
const assert = require('assert');

async function findFirstAssignAndInforef(baseDir) {
  const activitiesDir = path.join(baseDir, 'activities');
  const entries = await fs.readdir(activitiesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('assign_')) {
      const assignXml = path.join(activitiesDir, entry.name, 'assign.xml');
      const inforefXml = path.join(activitiesDir, entry.name, 'inforef.xml');
      if (existsSync(assignXml) && existsSync(inforefXml)) {
        return { assignXml, inforefXml };
      }
    }
  }
  return null;
}

async function main() {
  const sampleMbz = path.resolve('sample.mbz');
  if (!existsSync(sampleMbz)) {
    console.error('sample.mbz not found in project root.');
    process.exit(1);
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbz-assigncreate-'));

  try {
    await extractMbz(sampleMbz, tmpDir);
    const found = await findFirstAssignAndInforef(tmpDir);
    if (!found) {
      console.error('No assign.xml/inforef.xml found in extracted sample.');
      return;
    }
    const assignTemplateContent = await fs.readFile(found.assignXml, 'utf8');
    const inforefTemplateContent = await fs.readFile(found.inforefXml, 'utf8');
    // Test IDs and info
    const newModuleId = 99999;
    const newActivityId = 88888;
    const startPluginConfigId = 77777;
    const newGradeItemId = 66666;
    const newContextId = 55555;
    const newGradingAreaId = 44444;
    const newSortorder = 33333;
    const assignmentInfo = {
      name: 'Created Assignment',
      due_ts: 2000000000,
      cutoff_ts: 2000000300,
      activation_ts: 1999999999,
    };
    const sectionId = 12345;
    await createNewAssignmentFiles(
      tmpDir,
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
    );
    // Check files
    const assignDir = path.join(tmpDir, 'activities', `assign_${newModuleId}`);
    const expectedFiles = [
      'assign.xml',
      'inforef.xml',
      'module.xml',
      'grades.xml',
      'grading.xml',
      'grade_history.xml',
      'roles.xml',
    ];
    const filesWithName = ['assign.xml', 'grades.xml'];
    for (const file of expectedFiles) {
      const filePath = path.join(assignDir, file);
      assert(existsSync(filePath), `${file} was not created`);
      const content = await fs.readFile(filePath, 'utf8');
      if (filesWithName.includes(file)) {
        assert(content.includes(assignmentInfo.name), `${file} does not contain assignment name`);
      }
    }
    console.log('✅ All assignment files created and contain expected content.');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
} 