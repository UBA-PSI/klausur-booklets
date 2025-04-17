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

    // Print all section IDs in moodle_backup.xml for debugging
    const mbContentBefore = await fs.readFile(moodleBackupXml, 'utf8');
    const sectionIdPattern = /<sectionid>(\d+)<\/sectionid>/g;
    let match;
    console.log('Section IDs in moodle_backup.xml:');
    while ((match = sectionIdPattern.exec(mbContentBefore)) !== null) {
      console.log('  Found sectionid:', match[1]);
    }

    // Use a real sectionId from the file for the test
    const realSectionIdMatch = mbContentBefore.match(/<sectionid>(\d+)<\/sectionid>/);
    const testSectionId = realSectionIdMatch ? parseInt(realSectionIdMatch[1], 10) : 12345;
    
    // Now that testSectionId is defined, we can use it for debugging
    console.log('Using testSectionId:', testSectionId);
    
    // Print context around <sectionid> occurrences
    const lines = mbContentBefore.split('\n');
    lines.forEach((line, idx) => {
      if (line.includes(`<sectionid>${testSectionId}</sectionid>`)) {
        console.log(`Context around <sectionid>${testSectionId}</sectionid> at line ${idx + 1}:`);
        for (let i = Math.max(0, idx - 3); i <= Math.min(lines.length - 1, idx + 3); i++) {
          console.log(lines[i]);
        }
        console.log('---');
      }
    });

    // Print the first 10000 characters for visual inspection
    console.log('First 10000 chars of moodle_backup.xml:\n', mbContentBefore.slice(0, 10000));

    // Check explicitly for section tags
    console.log('Does XML contain <section> tag?', mbContentBefore.includes('<section>'));
    console.log('Does XML contain <sections> tag?', mbContentBefore.includes('<sections>'));
    
    // Find indices of key section-related strings
    const sectionStartIndex = mbContentBefore.indexOf('<section>');
    const sectionEndIndex = mbContentBefore.indexOf('</section>');
    const sectionsStartIndex = mbContentBefore.indexOf('<sections>');
    const sectionsEndIndex = mbContentBefore.indexOf('</sections>');
    
    console.log('Section tag indices:', {
      sectionStartIndex,
      sectionEndIndex,
      sectionsStartIndex,
      sectionsEndIndex
    });
    
    // Get context around section tag if found
    if (sectionStartIndex > -1) {
      const contextBefore = mbContentBefore.substring(Math.max(0, sectionStartIndex - 50), sectionStartIndex);
      const contextAfter = mbContentBefore.substring(sectionStartIndex, sectionStartIndex + 200);
      console.log('Context around <section> tag:');
      console.log('Before:', contextBefore);
      console.log('After:', contextAfter);
    }
    
    // Find the section with our ID
    const sectionIdTag = `<sectionid>${testSectionId}</sectionid>`;
    const sectionIdIndex = mbContentBefore.indexOf(sectionIdTag);
    
    if (sectionIdIndex > -1) {
      // Find the enclosing section tag before and after
      const sectionTagBefore = mbContentBefore.lastIndexOf('<section>', sectionIdIndex);
      const sectionTagAfter = mbContentBefore.indexOf('</section>', sectionIdIndex);
      
      if (sectionTagBefore > -1 && sectionTagAfter > -1) {
        const sectionContent = mbContentBefore.substring(sectionTagBefore, sectionTagAfter + 10);
        console.log(`Found section containing ID ${testSectionId}:`);
        console.log(sectionContent);
      }
    }
    
    // Try different regex patterns to find the section
    
    // Pattern for <section>...</section> containing our section ID
    const sectionPattern = new RegExp(`<section>\\s*<sectionid>${testSectionId}</sectionid>[\\s\\S]*?</section>`, 'gi');
    const sectionBlocks = mbContentBefore.match(sectionPattern) || [];
    console.log('Section blocks matching pattern:', sectionBlocks.length);
    sectionBlocks.forEach((block, i) => {
      console.log(`--- Section Block ${i + 1} ---\n${block}\n`);
    });

    // Pattern for the entire <sections>...</sections> container
    const sectionsPattern = new RegExp(`<sections>\\s*[\\s\\S]*?<section>\\s*<sectionid>${testSectionId}</sectionid>[\\s\\S]*?</section>\\s*[\\s\\S]*?</sections>`, 'gi');
    const sectionsBlocks = mbContentBefore.match(sectionsPattern) || [];
    console.log('Sections container blocks:', sectionsBlocks.length);
    sectionsBlocks.forEach((block, i) => {
      console.log(`--- Sections Container ${i + 1} ---\n${block}\n`);
    });
    
    const testAddedModuleIds = [333];

    // Test updateSectionXml
    const testModuleIds = [111, 222, 333];
    const testSectionTitle = 'Test Section Title';
    await updateSectionXml(sectionXml, testModuleIds, testSectionTitle);
    const sectionContent = await fs.readFile(sectionXml, 'utf8');
    assert(sectionContent.includes(`<sequence>${testModuleIds.join(',')}</sequence>`), 'Section sequence not updated');
    assert(sectionContent.includes(`<name>${testSectionTitle}</name>`), 'Section title not updated');

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
      testAddedModuleIds,
      testSectionTitle,
      testTargetStartTimestamp
    );
    const mbContentAfter = await fs.readFile(moodleBackupXml, 'utf8');

    assert(mbContentAfter.includes(`<name>${testFilename}</name>`), 'Filename not updated');
    assert(mbContentAfter.includes('backup_id="cafebabe"'), 'Backup ID not updated');
    assert(mbContentAfter.includes(`<title>${testSectionTitle}</title>`), 'Section title in <sections> not updated');
    assert(mbContentAfter.includes(`<moduleid>111</moduleid>`), 'Moduleid 111 not in activities');
    assert(mbContentAfter.includes(`<moduleid>222</moduleid>`), 'Moduleid 222 not in activities');
    assert(mbContentAfter.includes(`<moduleid>333</moduleid>`), 'Moduleid 333 not in activities');
    assert(mbContentAfter.includes(`<original_course_startdate>${testTargetStartTimestamp}</original_course_startdate>`), 'Startdate not updated');
    console.log('✅ Manifest update assertions passed.');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
} 