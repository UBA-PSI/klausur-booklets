const { extractMbz } = require('../lib/archive');
const { updateSectionXml, updateMoodleBackupXml } = require('../lib/manifest');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { existsSync } = require('fs');
const assert = require('assert');

async function findSectionXml(baseDir) {
    const sectionsDir = path.join(baseDir, 'sections');
    const entries = await fs.readdir(sectionsDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('section_')) {
            const sectionXml = path.join(sectionsDir, entry.name, 'section.xml');
            if (existsSync(sectionXml)) return sectionXml;
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

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbz-manifest-'));

    try {
        await extractMbz(sampleMbz, tmpDir);

        // Find section.xml
        const sectionXml = await findSectionXml(tmpDir);
        assert(sectionXml, 'No section.xml found');

        // Find moodle_backup.xml
        const moodleBackupXml = path.join(tmpDir, 'moodle_backup.xml');
        assert(existsSync(moodleBackupXml), 'No moodle_backup.xml found');

        // Get a real sectionId from the file
        const mbContentBefore = await fs.readFile(moodleBackupXml, 'utf8');
        const realSectionIdMatch = mbContentBefore.match(/<sectionid>(\d+)<\/sectionid>/);
        const testSectionId = realSectionIdMatch ? realSectionIdMatch[1] : '12345';

        // Test updateSectionXml
        const testModuleIds = [111, 222, 333];
        const testSectionTitle = 'Test Section Title';
        await updateSectionXml(sectionXml, testModuleIds, testSectionTitle);
        const sectionContent = await fs.readFile(sectionXml, 'utf8');
        assert(sectionContent.includes(`<sequence>${testModuleIds.join(',')}</sequence>`), 'Section sequence not updated');
        assert(sectionContent.includes(`<name>${testSectionTitle}</name>`), 'Section title not updated');
        console.log('✅ updateSectionXml assertions passed.');

        // Test updateMoodleBackupXml
        const testFilename = 'testfile.mbz';
        const testOrigBackupId = 'deadbeef';
        const testNewBackupId = 'cafebabe';
        const testAssignments = [
            { name: 'A1', moduleid: 111 },
            { name: 'A2', moduleid: 222 },
            { name: 'A3', moduleid: 333 },
        ];
        const testTargetStartTimestamp = 2000000000;

        // Insert a fake backup_id for testing
        let mbContent = await fs.readFile(moodleBackupXml, 'utf8');
        if (!mbContent.includes('backup_id="deadbeef"')) {
            mbContent = mbContent.replace(/backup_id="[a-f0-9]+"/, 'backup_id="deadbeef"');
            await fs.writeFile(moodleBackupXml, mbContent, 'utf8');
        }

        await updateMoodleBackupXml(
            moodleBackupXml,
            testFilename,
            testOrigBackupId,
            testNewBackupId,
            testAssignments,
            testSectionId,
            testSectionTitle,
            testTargetStartTimestamp
        );
        const mbContentAfter = await fs.readFile(moodleBackupXml, 'utf8');

        assert(mbContentAfter.includes(`<name>${testFilename}</name>`), 'Filename not updated');
        assert(mbContentAfter.includes('backup_id="cafebabe"'), 'Backup ID not updated');
        assert(mbContentAfter.includes(`<original_course_startdate>${testTargetStartTimestamp}</original_course_startdate>`), 'Startdate not updated');
        console.log('✅ updateMoodleBackupXml assertions passed.');
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}

if (require.main === module) {
    main().catch(e => { console.error(e); process.exit(1); });
}
