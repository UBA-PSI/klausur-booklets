const { extractMbz } = require('../lib/archive');
const { modifyAssignment } = require('../lib/assignmentFiles');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { existsSync } = require('fs');
const assert = require('assert');

async function findFirstAssignXml(baseDir) {
  const activitiesDir = path.join(baseDir, 'activities');
  const entries = await fs.readdir(activitiesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('assign_')) {
      const assignXml = path.join(activitiesDir, entry.name, 'assign.xml');
      if (existsSync(assignXml)) return assignXml;
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

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbz-assignmod-'));

  try {
    await extractMbz(sampleMbz, tmpDir);
    const assignXml = await findFirstAssignXml(tmpDir);
    if (!assignXml) {
      console.error('No assign.xml found in extracted sample.');
      return;
    }
    const before = await fs.readFile(assignXml, 'utf8');
    console.log('Before modification (snippet):', before.slice(0, 1000));
    const testName = 'Test Assignment Name';
    const testDue = 2000000000;
    const testCutoff = 2000000300;
    const testActivation = 1999999999;
    await modifyAssignment(assignXml, testName, testDue, testCutoff, testActivation);
    const after = await fs.readFile(assignXml, 'utf8');
    console.log('After modification (snippet):', after.slice(0, 1000));
    // Assertions
    assert(after.includes(`<name>${testName}</name>`), 'Name not updated correctly');
    assert(after.includes(`<duedate>${testDue}</duedate>`), 'Due date not updated correctly');
    assert(after.includes(`<cutoffdate>${testCutoff}</cutoffdate>`), 'Cutoff date not updated correctly');
    assert(after.includes(`<allowsubmissionsfromdate>${testActivation}</allowsubmissionsfromdate>`), 'Activation date not updated correctly');
    console.log('✅ All assertions passed.');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
} 