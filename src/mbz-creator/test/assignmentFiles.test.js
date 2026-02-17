const { extractMbz } = require('../lib/archive');
const { parseAssignment, modifyAssignment } = require('../lib/assignmentFiles');
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
            const moduleId = entry.name.replace('assign_', '');
            if (existsSync(assignXml)) return { assignXml, moduleId };
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

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbz-assigntest-'));

    try {
        await extractMbz(sampleMbz, tmpDir);
        const found = await findFirstAssignXml(tmpDir);
        if (!found) {
            console.error('No assign.xml found in extracted sample.');
            return;
        }

        // Test parseAssignment
        const parsed = await parseAssignment(found.assignXml, found.moduleId);
        assert(parsed, 'parseAssignment should return an object');
        assert.strictEqual(parsed.moduleId, found.moduleId, 'moduleId should match');
        assert(typeof parsed.name === 'string', 'name should be a string');
        assert(typeof parsed.duedate === 'number', 'duedate should be a number');
        assert(typeof parsed.cutoffdate === 'number', 'cutoffdate should be a number');
        assert(typeof parsed.allowsubmissionsfromdate === 'number', 'allowsubmissionsfromdate should be a number');
        console.log('Parsed assignment:', parsed);
        console.log('✅ parseAssignment assertions passed.');

        // Test parseAssignment with non-existent file
        const missing = await parseAssignment('/nonexistent/path/assign.xml', '999');
        assert.strictEqual(missing, null, 'parseAssignment should return null for missing files');
        console.log('✅ parseAssignment returns null for missing file.');

        // Test modifyAssignment
        const testName = 'Test Assignment Name';
        const testDue = 2000000000;
        const testCutoff = 2000000300;
        const testActivation = 1999999999;
        await modifyAssignment(found.assignXml, testName, testDue, testCutoff, testActivation);
        const after = await fs.readFile(found.assignXml, 'utf8');
        assert(after.includes(`<name>${testName}</name>`), 'Name not updated correctly');
        assert(after.includes(`<duedate>${testDue}</duedate>`), 'Due date not updated correctly');
        assert(after.includes(`<cutoffdate>${testCutoff}</cutoffdate>`), 'Cutoff date not updated correctly');
        assert(after.includes(`<allowsubmissionsfromdate>${testActivation}</allowsubmissionsfromdate>`), 'Activation date not updated correctly');
        console.log('✅ modifyAssignment assertions passed.');

        // Test modifyAssignment with $-pattern in name (regression test)
        const dollarName = 'Test $1 Name $& with $$';
        await modifyAssignment(found.assignXml, dollarName, testDue, testCutoff, testActivation);
        const afterDollar = await fs.readFile(found.assignXml, 'utf8');
        assert(afterDollar.includes(`<name>${dollarName}</name>`), 'Name with $ patterns not handled correctly');
        console.log('✅ modifyAssignment $-pattern regression test passed.');

    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}

if (require.main === module) {
    main().catch(e => { console.error(e); process.exit(1); });
}
