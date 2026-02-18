const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { existsSync } = require('fs');
const { parseAssignmentsFromMbz, modifyMoodleBackup } = require('../lib/mbzCreator');
const { extractMbz } = require('../lib/archive');
const { parseAssignment } = require('../lib/assignmentFiles');

async function main() {
    const sampleMbz = path.resolve('sample.mbz');
    if (!existsSync(sampleMbz)) {
        console.error('sample.mbz not found in project root.');
        process.exit(1);
    }

    // --- parseAssignmentsFromMbz ---

    const assignments = await parseAssignmentsFromMbz(sampleMbz);

    assert(Array.isArray(assignments), 'should return an array');
    assert(assignments.length > 0, 'should find at least one assignment');

    for (const a of assignments) {
        assert(typeof a.moduleId === 'string', 'moduleId should be a string');
        assert(typeof a.name === 'string', 'name should be a string');
        assert(typeof a.duedate === 'number', 'duedate should be a number');
        assert(typeof a.cutoffdate === 'number', 'cutoffdate should be a number');
        assert(typeof a.allowsubmissionsfromdate === 'number', 'allowsubmissionsfromdate should be a number');
    }

    // Module IDs should be naturally sorted (numeric ascending)
    const moduleIds = assignments.map(a => parseInt(a.moduleId, 10));
    for (let i = 1; i < moduleIds.length; i++) {
        assert(moduleIds[i] > moduleIds[i - 1],
            `module IDs should be sorted: ${moduleIds[i - 1]} < ${moduleIds[i]}`);
    }

    console.log(`✅ parseAssignmentsFromMbz: found ${assignments.length} assignments, all valid and sorted.`);

    // --- modifyMoodleBackup (full roundtrip) ---

    const outputMbz = path.join(os.tmpdir(), `mbztest-modified-${Date.now()}.mbz`);

    const testAssignments = assignments.map((a, i) => ({
        moduleId: a.moduleId,
        name: `Modified Assignment ${i + 1}`,
        due_ts: 2000000000 + i * 86400,
        cutoff_ts: 2000000000 + i * 86400 + 300,
        activation_ts: 2000000000 + i * 86400 - 604800,
    }));

    try {
        await modifyMoodleBackup({
            inputMbzPath: sampleMbz,
            outputMbzPath: outputMbz,
            assignments: testAssignments,
            sectionTitle: 'Integration Test Section',
            targetStartTimestamp: 1999900000,
        });

        assert(existsSync(outputMbz), 'output MBZ file should exist');
        console.log('✅ modifyMoodleBackup: output file created.');

        // Re-parse the modified MBZ and verify changes were applied
        const modified = await parseAssignmentsFromMbz(outputMbz);

        assert.strictEqual(modified.length, assignments.length,
            'modified MBZ should have same number of assignments');

        for (let i = 0; i < modified.length; i++) {
            const expected = testAssignments.find(t => t.moduleId === modified[i].moduleId);
            assert(expected, `should find moduleId ${modified[i].moduleId} in test data`);
            assert.strictEqual(modified[i].name, expected.name,
                `name mismatch for module ${modified[i].moduleId}`);
            assert.strictEqual(modified[i].duedate, expected.due_ts,
                `duedate mismatch for module ${modified[i].moduleId}`);
            assert.strictEqual(modified[i].cutoffdate, expected.cutoff_ts,
                `cutoffdate mismatch for module ${modified[i].moduleId}`);
            assert.strictEqual(modified[i].allowsubmissionsfromdate, expected.activation_ts,
                `activation mismatch for module ${modified[i].moduleId}`);
        }

        console.log('✅ modifyMoodleBackup: all assignments correctly modified in roundtrip.');

        // Verify manifest changes by extracting and reading moodle_backup.xml
        const verifyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbz-verify-'));
        try {
            await extractMbz(outputMbz, verifyDir);

            const mbXml = await fs.readFile(path.join(verifyDir, 'moodle_backup.xml'), 'utf8');
            assert(mbXml.includes('<original_course_startdate>1999900000</original_course_startdate>'),
                'target start timestamp should be set in moodle_backup.xml');
            console.log('✅ modifyMoodleBackup: target start timestamp written to manifest.');

            // Verify log file was truncated
            const logPath = path.join(verifyDir, 'moodle_backup.log');
            if (existsSync(logPath)) {
                const logContent = await fs.readFile(logPath, 'utf8');
                assert.strictEqual(logContent, '', 'log file should be truncated');
                console.log('✅ modifyMoodleBackup: log file truncated.');
            }
        } finally {
            await fs.rm(verifyDir, { recursive: true, force: true });
        }

    } finally {
        if (existsSync(outputMbz)) await fs.unlink(outputMbz);
    }

    // --- modifyMoodleBackup: error handling ---

    await assert.rejects(
        () => modifyMoodleBackup({ inputMbzPath: null, outputMbzPath: '/tmp/test.mbz' }),
        /Missing required options/,
        'should reject when inputMbzPath is missing'
    );
    console.log('✅ modifyMoodleBackup: rejects missing required options.');

    console.log('\n✅ All mbzCreator tests passed.');
}

if (require.main === module) {
    main().catch(e => { console.error(e); process.exit(1); });
}
