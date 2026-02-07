#!/usr/bin/env node

/**
 * ILIAS Preprocessor Automated Tests
 *
 * Tests the ILIAS ZIP preprocessing functionality including:
 * - Format detection (per-assignment vs per-student)
 * - ZIP extraction and restructuring
 * - Missing pages detection
 * - Page ordering (numerical sort)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const iliasPreprocessor = require('../../src/js/ilias-preprocessor');

// ANSI color codes for output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    gray: '\x1b[90m'
};

let testsPassed = 0;
let testsFailed = 0;

/**
 * Assertion helper
 */
function assert(condition, message) {
    if (condition) {
        console.log(`${colors.green}  ✓${colors.reset} ${message}`);
        testsPassed++;
        return true;
    } else {
        console.log(`${colors.red}  ✗${colors.reset} ${message}`);
        testsFailed++;
        return false;
    }
}

/**
 * Test case wrapper
 */
async function test(name, testFn) {
    console.log(`\n${colors.blue}▸${colors.reset} ${name}`);
    try {
        await testFn();
    } catch (error) {
        console.log(`${colors.red}  ✗ Test threw error: ${error.message}${colors.reset}`);
        console.log(`${colors.gray}${error.stack}${colors.reset}`);
        testsFailed++;
    }
}

/**
 * Test 1: ILIAS Mode Detection
 */
async function testIliasDetection() {
    await test('ILIAS Mode Detection', async () => {
        const perAssignmentDir = path.join(__dirname, 'per-assignment');
        const perStudentDir = path.join(__dirname, 'per-student');

        const detected1 = iliasPreprocessor.detectIliasZipMode(perAssignmentDir);
        assert(detected1 === true, 'Detected ILIAS mode for per-assignment directory');

        const detected2 = iliasPreprocessor.detectIliasZipMode(perStudentDir);
        assert(detected2 === true, 'Detected ILIAS mode for per-student directory');

        // Test non-ILIAS directory (should not detect)
        const srcDir = path.join(__dirname, '../../src');
        const detected3 = iliasPreprocessor.detectIliasZipMode(srcDir);
        assert(detected3 === false, 'Did NOT detect ILIAS mode for non-ZIP directory');
    });
}

/**
 * Test 2: Per-Assignment Format Processing
 */
async function testPerAssignmentFormat() {
    await test('Per-Assignment Format Processing & Missing Pages', async () => {
        const inputDir = path.join(__dirname, 'per-assignment');
        const tempDir = path.join(os.tmpdir(), `ilias-test-per-assignment-${Date.now()}`);

        try {
            // Run preprocessing
            const logs = [];
            iliasPreprocessor.preprocessIliasZips(
                inputDir,
                tempDir,
                (msg) => logs.push(msg),
                'LASTNAME_FIRSTNAME_USERNAME_STUDENTNUMBER'
            );

            // Check format detection
            const formatLog = logs.find(l => l.includes('Detected ILIAS format'));
            assert(formatLog && formatLog.includes('per-assignment'), 'Detected format as per-assignment');

            // Check that all page directories exist
            const expectedPages = ['Seite 2', 'Seite 3', 'Seite 4', 'Seite 5', 'Seite 10'];
            for (const page of expectedPages) {
                const pageDir = path.join(tempDir, page);
                assert(fs.existsSync(pageDir), `Page directory exists: ${page}`);
            }

            // Check page ordering (should be natural sort: 2, 3, 4, 5, 10 NOT 10, 2, 3, 4, 5)
            const actualPages = fs.readdirSync(tempDir)
                .filter(item => fs.statSync(path.join(tempDir, item)).isDirectory())
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

            assert(
                JSON.stringify(actualPages) === JSON.stringify(expectedPages),
                `Pages in correct numerical order: ${actualPages.join(', ')}`
            );

            // Check student submissions
            const seite3Dir = path.join(tempDir, 'Seite 3');
            const students = fs.readdirSync(seite3Dir).filter(item =>
                fs.statSync(path.join(seite3Dir, item)).isDirectory()
            );

            // Bob Quantum should be missing from Seite 3
            assert(!students.includes('Quantum_Bob_bquantum_902345'), 'Bob Quantum missing from Seite 3 (as expected)');
            assert(students.includes('Zephyr_Alice_azephyr_901234'), 'Alice Zephyr present in Seite 3');
            assert(students.includes('Nexus_Charlie_cnexus_903456'), 'Charlie Nexus present in Seite 3');

        } finally {
            // Cleanup
            iliasPreprocessor.cleanupTempDirectory(tempDir);
        }
    });
}

/**
 * Test 3: Per-Student Format Processing
 */
async function testPerStudentFormat() {
    await test('Per-Student Format Processing & Empty Assignment Folders', async () => {
        const inputDir = path.join(__dirname, 'per-student');
        const tempDir = path.join(os.tmpdir(), `ilias-test-per-student-${Date.now()}`);

        try {
            // Run preprocessing
            const logs = [];
            iliasPreprocessor.preprocessIliasZips(
                inputDir,
                tempDir,
                (msg) => logs.push(msg),
                'LASTNAME_FIRSTNAME_USERNAME_STUDENTNUMBER'
            );

            // Check format detection
            const formatLog = logs.find(l => l.includes('Detected ILIAS format'));
            assert(formatLog && formatLog.includes('per-student'), 'Detected format as per-student');

            // Check that all page directories exist (created from all student ZIPs)
            const expectedPages = ['Seite 2', 'Seite 3', 'Seite 4', 'Seite 5', 'Seite 10'];
            for (const page of expectedPages) {
                const pageDir = path.join(tempDir, page);
                assert(fs.existsSync(pageDir), `Page directory exists: ${page}`);
            }

            // Check Alice's submissions (missing Seite 4)
            const seite4Dir = path.join(tempDir, 'Seite 4');
            const seite4Students = fs.readdirSync(seite4Dir).filter(item =>
                fs.statSync(path.join(seite4Dir, item)).isDirectory()
            );
            assert(!seite4Students.includes('Zephyr_Alice_azephyr_901234'), 'Alice missing from Seite 4 (as expected)');

            // Check Bob's submissions (missing Seite 5 and 10)
            const seite5Dir = path.join(tempDir, 'Seite 5');
            const seite5Students = fs.readdirSync(seite5Dir).filter(item =>
                fs.statSync(path.join(seite5Dir, item)).isDirectory()
            );
            assert(!seite5Students.includes('Quantum_Bob_bquantum_902345'), 'Bob missing from Seite 5 (as expected)');

            const seite10Dir = path.join(tempDir, 'Seite 10');
            const seite10Students = fs.readdirSync(seite10Dir).filter(item =>
                fs.statSync(path.join(seite10Dir, item)).isDirectory()
            );
            assert(!seite10Students.includes('Quantum_Bob_bquantum_902345'), 'Bob missing from Seite 10 (as expected)');

        } finally {
            // Cleanup
            iliasPreprocessor.cleanupTempDirectory(tempDir);
        }
    });
}

/**
 * Test 4: Alternative Page Names
 */
async function testAlternativePageNames() {
    await test('Alternative Page Names (Exercise, Aufgabe, Übung)', async () => {
        const inputDir = path.join(__dirname, 'per-assignment-alt-names');
        const tempDir = path.join(os.tmpdir(), `ilias-test-alt-names-${Date.now()}`);

        try {
            // Run preprocessing
            iliasPreprocessor.preprocessIliasZips(
                inputDir,
                tempDir,
                () => {},
                'LASTNAME_FIRSTNAME_USERNAME_STUDENTNUMBER'
            );

            // Check that all page directories exist with different naming conventions
            const expectedPages = ['Aufgabe 1', 'Exercise 2', 'Exercise 3', 'Exercise 10', 'Übung 5'];
            for (const page of expectedPages) {
                const pageDir = path.join(tempDir, page);
                assert(fs.existsSync(pageDir), `Page directory exists: ${page}`);
            }

            // Check Alice missing from Exercise 10
            const exercise10Dir = path.join(tempDir, 'Exercise 10');
            const ex10Students = fs.readdirSync(exercise10Dir).filter(item =>
                fs.statSync(path.join(exercise10Dir, item)).isDirectory()
            );
            assert(!ex10Students.includes('Zephyr_Alice_azephyr_901234'), 'Alice missing from Exercise 10 (as expected)');

            // Check Charlie missing from Übung 5
            const ubung5Dir = path.join(tempDir, 'Übung 5');
            const u5Students = fs.readdirSync(ubung5Dir).filter(item =>
                fs.statSync(path.join(ubung5Dir, item)).isDirectory()
            );
            assert(!u5Students.includes('Nexus_Charlie_cnexus_903456'), 'Charlie missing from Übung 5 (as expected)');

        } finally {
            // Cleanup
            iliasPreprocessor.cleanupTempDirectory(tempDir);
        }
    });
}

/**
 * Test 5: Edge Cases (Umlauts, Empty ZIPs, Corrupt ZIPs, Mixed File Types)
 */
async function testEdgeCases() {
    await test('Edge Case: Umlauts in Student Names', async () => {
        const inputDir = path.join(__dirname, 'edge-cases', 'umlauts');
        const tempDir = path.join(os.tmpdir(), `ilias-test-umlauts-${Date.now()}`);

        try {
            const logs = [];
            iliasPreprocessor.preprocessIliasZips(
                inputDir,
                tempDir,
                (msg) => logs.push(msg),
                'LASTNAME_FIRSTNAME_USERNAME_STUDENTNUMBER'
            );

            // Check that umlauts work correctly
            const seite1Dir = path.join(tempDir, 'Seite 1');
            const students = fs.readdirSync(seite1Dir).filter(item =>
                fs.statSync(path.join(seite1Dir, item)).isDirectory()
            );

            assert(students.includes('Müller_Anna_amueller_801234'), 'Anna Müller present in Seite 1');
            assert(students.includes('Schäfer_Max_mschaefer_802345'), 'Max Schäfer present in Seite 1');
            assert(students.includes('Löwe_Lisa_lloewe_803456'), 'Lisa Löwe present in Seite 1');

            // Check Seite 2 - Anna Müller should be missing
            const seite2Dir = path.join(tempDir, 'Seite 2');
            const seite2Students = fs.readdirSync(seite2Dir).filter(item =>
                fs.statSync(path.join(seite2Dir, item)).isDirectory()
            );
            assert(!seite2Students.includes('Müller_Anna_amueller_801234'), 'Anna Müller missing from Seite 2 (as expected)');

        } finally {
            iliasPreprocessor.cleanupTempDirectory(tempDir);
        }
    });

    await test('Edge Case: Empty ZIP File', async () => {
        const inputDir = path.join(__dirname, 'edge-cases');
        const tempDir = path.join(os.tmpdir(), `ilias-test-empty-${Date.now()}`);

        try {
            // Create temp dir with only the empty.zip
            const testInputDir = path.join(os.tmpdir(), `ilias-input-empty-${Date.now()}`);
            fs.mkdirSync(testInputDir, { recursive: true });
            fs.copyFileSync(
                path.join(inputDir, 'empty.zip'),
                path.join(testInputDir, 'Seite 1.zip')
            );

            const logs = [];
            let errorThrown = false;
            try {
                iliasPreprocessor.preprocessIliasZips(
                    testInputDir,
                    tempDir,
                    (msg) => logs.push(msg),
                    'LASTNAME_FIRSTNAME_USERNAME_STUDENTNUMBER'
                );
            } catch (error) {
                errorThrown = true;
            }

            // Empty ZIP should either be skipped gracefully or cause expected error
            assert(errorThrown || logs.some(l => l.includes('WARNING') || l.includes('skipping')),
                'Empty ZIP handled gracefully (error or warning)');

            // Cleanup
            fs.rmSync(testInputDir, { recursive: true, force: true });
        } finally {
            iliasPreprocessor.cleanupTempDirectory(tempDir);
        }
    });

    await test('Edge Case: Corrupt ZIP File', async () => {
        const inputDir = path.join(__dirname, 'edge-cases');
        const tempDir = path.join(os.tmpdir(), `ilias-test-corrupt-${Date.now()}`);

        try {
            // Create temp dir with only the corrupt.zip
            const testInputDir = path.join(os.tmpdir(), `ilias-input-corrupt-${Date.now()}`);
            fs.mkdirSync(testInputDir, { recursive: true });
            fs.copyFileSync(
                path.join(inputDir, 'corrupt.zip'),
                path.join(testInputDir, 'Seite 1.zip')
            );

            const logs = [];
            let errorThrown = false;
            try {
                iliasPreprocessor.preprocessIliasZips(
                    testInputDir,
                    tempDir,
                    (msg) => logs.push(msg),
                    'LASTNAME_FIRSTNAME_USERNAME_STUDENTNUMBER'
                );
            } catch (error) {
                errorThrown = true;
            }

            // Corrupt ZIP should cause an error
            assert(errorThrown, 'Corrupt ZIP throws error as expected');

            // Cleanup
            fs.rmSync(testInputDir, { recursive: true, force: true });
        } finally {
            iliasPreprocessor.cleanupTempDirectory(tempDir);
        }
    });

    await test('Edge Case: Mixed File Types (PDF, PNG, JPEG) and Special Characters', async () => {
        const inputDir = path.join(__dirname, 'edge-cases');
        const tempDir = path.join(os.tmpdir(), `ilias-test-mixed-${Date.now()}`);

        try {
            // Create temp dir with only the mixed files ZIP
            const testInputDir = path.join(os.tmpdir(), `ilias-input-mixed-${Date.now()}`);
            fs.mkdirSync(testInputDir, { recursive: true });
            fs.copyFileSync(
                path.join(inputDir, 'Seite 1 - Special Files.zip'),
                path.join(testInputDir, 'Seite 1 - Special Files.zip')
            );

            iliasPreprocessor.preprocessIliasZips(
                testInputDir,
                tempDir,
                () => {},
                'LASTNAME_FIRSTNAME_USERNAME_STUDENTNUMBER'
            );

            // Check that the page directory exists
            const pageDir = path.join(tempDir, 'Seite 1 - Special Files');
            assert(fs.existsSync(pageDir), 'Page directory with special characters created');

            // Check that student folder exists
            const studentDir = path.join(pageDir, 'Müller_Anna_amueller_801234');
            assert(fs.existsSync(studentDir), 'Student folder created');

            // Check that all file types were extracted
            const files = fs.readdirSync(studentDir);
            assert(files.some(f => f.endsWith('.pdf')), 'PDF file extracted');
            assert(files.some(f => f.endsWith('.png')), 'PNG file extracted');
            assert(files.some(f => f.endsWith('.jpg')), 'JPEG file extracted');
            assert(files.some(f => f.includes('übung')), 'File with umlaut in name extracted');

            // Cleanup
            fs.rmSync(testInputDir, { recursive: true, force: true });
        } finally {
            iliasPreprocessor.cleanupTempDirectory(tempDir);
        }
    });

    await test('Edge Case: Invalid ZIP Structure (No Abgaben Directory)', async () => {
        const inputDir = path.join(__dirname, 'edge-cases');
        const tempDir = path.join(os.tmpdir(), `ilias-test-invalid-${Date.now()}`);

        try {
            // Create temp dir with only the invalid structure ZIP
            const testInputDir = path.join(os.tmpdir(), `ilias-input-invalid-${Date.now()}`);
            fs.mkdirSync(testInputDir, { recursive: true });
            fs.copyFileSync(
                path.join(inputDir, 'Seite 2 - Invalid Structure.zip'),
                path.join(testInputDir, 'Seite 2 - Invalid Structure.zip')
            );

            const logs = [];
            let errorThrown = false;
            let errorMessage = '';
            try {
                iliasPreprocessor.preprocessIliasZips(
                    testInputDir,
                    tempDir,
                    (msg) => logs.push(msg),
                    'LASTNAME_FIRSTNAME_USERNAME_STUDENTNUMBER'
                );
            } catch (error) {
                errorThrown = true;
                errorMessage = error.message;
            }

            // Invalid structure should either throw error or log warning
            assert(
                errorThrown || logs.some(l => l.includes('WARNING') || l.includes('No "Abgaben"')),
                'Invalid ZIP structure handled (error or warning about missing Abgaben)'
            );

            // If error was thrown, it should mention the issue
            if (errorThrown) {
                assert(
                    errorMessage.includes('Abgaben') || errorMessage.includes('failed'),
                    'Error message mentions the structural issue'
                );
            }

            // Cleanup
            fs.rmSync(testInputDir, { recursive: true, force: true });
        } finally {
            iliasPreprocessor.cleanupTempDirectory(tempDir);
        }
    });
}

/**
 * Main test runner
 */
async function main() {
    console.log(`${colors.blue}═══════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.blue}  ILIAS Preprocessor Automated Tests${colors.reset}`);
    console.log(`${colors.blue}═══════════════════════════════════════════════════${colors.reset}`);

    // Check if test data exists
    const testDirs = ['per-assignment', 'per-student', 'per-assignment-alt-names', 'edge-cases'];
    const missingDirs = testDirs.filter(dir => !fs.existsSync(path.join(__dirname, dir)));

    if (missingDirs.length > 0) {
        console.log(`\n${colors.yellow}⚠ Test data not found. Generating...${colors.reset}`);
        console.log(`${colors.gray}  Missing: ${missingDirs.join(', ')}${colors.reset}`);
        console.log(`${colors.gray}  Run: node testdata/ilias/generate-test-zips.js${colors.reset}\n`);
        process.exit(1);
    }

    // Run tests
    await testIliasDetection();
    await testPerAssignmentFormat();
    await testPerStudentFormat();
    await testAlternativePageNames();
    await testEdgeCases();

    // Summary
    console.log(`\n${colors.blue}═══════════════════════════════════════════════════${colors.reset}`);
    const total = testsPassed + testsFailed;
    if (testsFailed === 0) {
        console.log(`${colors.green}✓ All tests passed!${colors.reset} (${testsPassed}/${total})`);
        console.log(`${colors.blue}═══════════════════════════════════════════════════${colors.reset}\n`);
        process.exit(0);
    } else {
        console.log(`${colors.red}✗ Some tests failed${colors.reset} (${testsPassed}/${total} passed, ${testsFailed}/${total} failed)`);
        console.log(`${colors.blue}═══════════════════════════════════════════════════${colors.reset}\n`);
        process.exit(1);
    }
}

// Run tests
if (require.main === module) {
    main().catch(error => {
        console.error(`${colors.red}Fatal error:${colors.reset}`, error);
        process.exit(1);
    });
}

module.exports = { test, assert };
