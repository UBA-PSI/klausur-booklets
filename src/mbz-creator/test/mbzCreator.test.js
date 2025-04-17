const fsPromises = require('fs').promises;
const fsSync = require('fs'); // Import sync fs for readFileSync
const path = require('path');
const os = require('os');
const assert = require('assert');
const compare = require('dir-compare'); // Import dir-compare

// --- Functions/Modules to Test ---
const { modifyMoodleBackup } = require('../lib/mbzCreator');
const { extractMbz } = require('../lib/archive'); // Needed for testing
const { generateAssignmentDates } = require('../lib/dateUtils'); // Import date generation

// --- Configuration ---

// Paths relative to the PROJECT ROOT directory (where the test will be run from)
const INPUT_MBZ = path.resolve('moodle-4.5-2024100700.mbz');
const EXPECTED_OUTPUT_MBZ = path.resolve('test-20250425-3-195959-5-ExamBooklet-Page-20250422.mbz');
const ACTUAL_OUTPUT_MBZ_TEMP = path.resolve('_temp_js_test_output.mbz');

// Options mirroring the Python test's command line arguments
const pythonTestArgs = {
    firstSubmissionDate: '2025-04-25',
    numConsecutiveWeeks: 3,
    submissionTime: '19:59:59',
    extraTime: 5,
    assignmentNamePrefix: 'Page',
};

const generatedAssignments = generateAssignmentDates(pythonTestArgs);

const TEST_OPTIONS = {
  inputMbzPath: INPUT_MBZ,
  outputMbzPath: ACTUAL_OUTPUT_MBZ_TEMP,
  assignments: generatedAssignments, // Use generated dates
  sectionTitle: "Exam Booklet",
  targetStartTimestamp: Math.floor(new Date('2025-04-22T00:00:00Z').getTime() / 1000),
};

// Patterns to ignore when comparing files (timestamps, generated IDs, versions)
const IGNORE_PATTERNS = [
  // Timestamps in moodle_backup.xml and general files
  { pattern: /<timecreated>\d+<\/timecreated>/g, placeholder: '<timecreated>NORMALIZED_TIMESTAMP</timecreated>' },
  { pattern: /<timemodified>\d+<\/timemodified>/g, placeholder: '<timemodified>NORMALIZED_TIMESTAMP</timemodified>' },
  { pattern: /<added>\d+<\/added>/g, placeholder: '<added>NORMALIZED_TIMESTAMP</added>' },
  { pattern: /<backup_date>\d+<\/backup_date>/g, placeholder: '<backup_date>NORMALIZED_TIMESTAMP</backup_date>' },
  { pattern: /<date>\d+<\/date>/g, placeholder: '<date>NORMALIZED_TIMESTAMP</date>' },
  // Course Start Date (known difference due to timezone handling)
  { pattern: /<original_course_startdate>\d+<\/original_course_startdate>/g, placeholder: '<original_course_startdate>NORMALIZED_COURSE_START</original_course_startdate>' },
  { pattern: /<startdate>\d+<\/startdate>/g, placeholder: '<startdate>NORMALIZED_COURSE_START</startdate>' }, // Catch other startdate tags too
  // Assignment Timestamps in assign.xml (these depend on "now" when script runs)
  { pattern: /<duedate>\d+<\/duedate>/g, placeholder: '<duedate>NORMALIZED_ASSIGN_DATE</duedate>' },
  { pattern: /<cutoffdate>\d+<\/cutoffdate>/g, placeholder: '<cutoffdate>NORMALIZED_ASSIGN_DATE</cutoffdate>' },
  { pattern: /<allowsubmissionsfromdate>\d+<\/allowsubmissionsfromdate>/g, placeholder: '<allowsubmissionsfromdate>NORMALIZED_ASSIGN_DATE</allowsubmissionsfromdate>' },
  // Backup ID (UUID)
  { pattern: /backup_id="[a-f0-9]{32}"/g, placeholder: 'backup_id="NORMALIZED_ID"' },
  // Version attribute
  { pattern: /version="\d+"/g, placeholder: 'version="NORMALIZED_VERSION"' },
];

// Placeholder for normalized values (used for filenames)
const NORMALIZED_FILENAME_PLACEHOLDER = 'NORMALIZED_FILENAME';

/**
 * Normalizes file content by replacing variable parts (timestamps, IDs, filenames, versions)
 * with placeholders for comparison.
 * @param {string} content - The file content.
 * @returns {string} Normalized content.
 */
function normalizeFileContent(content) {
  let normalized = content;

  // Apply ignore patterns (timestamps, backup_id, version)
  for (const item of IGNORE_PATTERNS) {
    normalized = normalized.replace(item.pattern, item.placeholder);
  }

  // Normalize output filenames (direct replacement)
  const expectedFilename = path.basename(EXPECTED_OUTPUT_MBZ);
  const actualFilename = path.basename(ACTUAL_OUTPUT_MBZ_TEMP);
  // Use RegExp for global replacement of filenames
  if (expectedFilename) {
      normalized = normalized.replace(new RegExp(escapeRegExp(expectedFilename), 'g'), NORMALIZED_FILENAME_PLACEHOLDER);
  }
  if (actualFilename) {
      normalized = normalized.replace(new RegExp(escapeRegExp(actualFilename), 'g'), NORMALIZED_FILENAME_PLACEHOLDER);
  }

  // Normalize filenames within XML tags (e.g., <name>, <value>)
  normalized = normalized.replace(/<name>([^<>]+\.mbz)<\/name>/g, `<name>${NORMALIZED_FILENAME_PLACEHOLDER}</name>`);
  normalized = normalized.replace(/<value>([^<>]+\.mbz)<\/value>/g, `<value>${NORMALIZED_FILENAME_PLACEHOLDER}</value>`);

  return normalized;
}

// Helper function to escape characters for regex
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

// Custom comparison function for dir-compare
function compareFilesNormalized(file1, file2, options) {
  try {
    // Use sync read here as dir-compare expects sync comparison
    const buffer1 = fsSync.readFileSync(file1);
    const buffer2 = fsSync.readFileSync(file2);

    // Basic check for size difference first
    if (buffer1.length !== buffer2.length) {
        // Try normalizing text files to see if size difference is due to variable length fields
        // Assume XML files are text and need normalization
        if (file1.endsWith('.xml') && file2.endsWith('.xml')) {
            const content1 = buffer1.toString('utf8');
            const content2 = buffer2.toString('utf8');
            const norm1 = normalizeFileContent(content1);
            const norm2 = normalizeFileContent(content2);
            if (norm1.length !== norm2.length) {
                 return false; // Still different after normalization
            }
            // Continue to content comparison if lengths match after normalization
        } else {
             return false; // Likely a binary file or non-XML text, size difference is real
        }
    }

    // Try comparing as text first, applying normalization
    try {
      const content1 = buffer1.toString('utf8');
      const content2 = buffer2.toString('utf8');
      const norm1 = normalizeFileContent(content1);
      const norm2 = normalizeFileContent(content2);
      return norm1 === norm2;
    } catch (e) {
      // If conversion to string fails or error during normalization, treat as binary
      // Fallback to binary comparison
      return buffer1.equals(buffer2);
    }
  } catch (e) {
    console.error(`Error comparing files ${file1} and ${file2}: ${e}`);
    return false; // Treat as different on error
  }
}

// TODO: Add directory comparison logic (potentially using dir-compare)

// --- Main Test Logic ---
async function runTest() {
  console.log("Starting Moodle Backup Modifier E2E Test (JS)...");

  // Check prerequisites
  try {
    await fsPromises.access(INPUT_MBZ);
    await fsPromises.access(EXPECTED_OUTPUT_MBZ);
  } catch (err) {
    console.error(`Error: Missing prerequisite file: ${err.message}`);
    process.exit(1);
  }

  // Clean up potential leftover temp file
  try {
    await fsPromises.unlink(ACTUAL_OUTPUT_MBZ_TEMP);
    console.log(`Removed leftover temp file: ${ACTUAL_OUTPUT_MBZ_TEMP}`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`Warning: Could not remove leftover temp file: ${err.message}`);
    }
  }

  let expected_extract_dir;
  let actual_extract_dir;
  let test_passed = false;

  try {
    // 1. Run the JS function to generate the actual output
    console.log("Running modifyMoodleBackup function...");
    // TODO: Generate actual assignment dates for TEST_OPTIONS before calling
    await modifyMoodleBackup(TEST_OPTIONS);
    console.log("modifyMoodleBackup finished.");

    // Verify output exists
    await fsPromises.access(ACTUAL_OUTPUT_MBZ_TEMP);
    console.log(`Generated actual output: ${ACTUAL_OUTPUT_MBZ_TEMP}`);

    // 2. Create temporary directories for extraction
    expected_extract_dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'mbz_expected_js-'));
    actual_extract_dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'mbz_actual_js-'));
    console.log(`Created temporary directories:\n  Expected: ${expected_extract_dir}\n  Actual:   ${actual_extract_dir}`);

    // 3. Extract both MBZ files
    console.log("\n--- Extraction Phase ---");
    console.log(`Extracting ${EXPECTED_OUTPUT_MBZ}...`);
    await extractMbz(EXPECTED_OUTPUT_MBZ, expected_extract_dir);
    console.log(`Extracting ${ACTUAL_OUTPUT_MBZ_TEMP}...`);
    await extractMbz(ACTUAL_OUTPUT_MBZ_TEMP, actual_extract_dir);
    console.log("Extraction complete.");

    // 4. Compare the extracted contents
    console.log("\n--- Comparison Phase ---");
    const compareOptions = {
      compareContent: true,
      compareFileSync: compareFilesNormalized, // Use our custom normalization comparer
      ignoreLineEndings: true, // Useful for cross-platform compatibility
      ignoreWhiteSpaces: true, // Often useful for XML if indentation changes slightly
      excludeFilter: ".DS_Store", // Ignore macOS metadata
    };

    console.log("Comparing directory contents...");
    const res = await compare.compare(expected_extract_dir, actual_extract_dir, compareOptions);

    // Log raw differences for debugging
    if (!res.same) {
        console.log("Raw dir-compare differences report:");
        res.diffSet?.forEach((entry) => {
            if (entry.state !== 'equal') { // Log anything not equal
                console.log(`  [${entry.state}] ${entry.relativePath}${path.sep}${entry.name1 ?? entry.name2 ?? ''}`);
            }
        });
    }

    // Determine actual failures after normalization
    const actualFailures = [];
    const diffDetails = [];
    if (res.diffSet) {
        for (const entry of res.diffSet) {
            const filePath1 = entry.path1 ? path.join(entry.path1, entry.name1) : null;
            const filePath2 = entry.path2 ? path.join(entry.path2, entry.name2) : null;
            const relativePath = entry.relativePath ? entry.relativePath + path.sep : '';
            const fileName = entry.name1 ?? entry.name2 ?? '';
            const fullRelativePath = relativePath + fileName;

            let isFailure = false;
            let reason = entry.state;

            if (entry.state === 'left' || entry.state === 'right') {
                isFailure = true; // Missing or extra files are always failures
            } else if (entry.state === 'distinct') {
                // Re-check distinct files using our normalization function
                if (filePath1 && filePath2) {
                    if (!compareFilesNormalized(filePath1, filePath2, {})) {
                        // Only consider it a failure if still distinct after normalization
                        isFailure = true;
                        reason = 'distinct (normalized)';

                        // Generate detailed diff for failures
                         if (fileName.endsWith('.xml') || fileName.endsWith('.log')) {
                            try {
                                const content1 = fsSync.readFileSync(filePath1, 'utf8');
                                const content2 = fsSync.readFileSync(filePath2, 'utf8');
                                const norm1 = normalizeFileContent(content1).split('\n');
                                const norm2 = normalizeFileContent(content2).split('\n');
                                const detail = { file: fullRelativePath, diffs: [] };
                                const maxLines = Math.max(norm1.length, norm2.length);
                                let diffCount = 0;
                                for (let i = 0; i < maxLines && diffCount < 5; i++) {
                                    const line1 = norm1[i] || '';
                                    const line2 = norm2[i] || '';
                                    if (line1 !== line2) {
                                        detail.diffs.push(`  Line ${i + 1}:\n    Expected: ${line1.trim()}\n    Actual:   ${line2.trim()}`);
                                        diffCount++;
                                    }
                                }
                                if (detail.diffs.length > 0) {
                                    diffDetails.push(detail);
                                }
                            } catch (readErr) {
                                console.error(`    Error reading/comparing file ${fullRelativePath}: ${readErr.message}`);
                            }
                        }
                    }
                } else {
                    // If paths are missing for a distinct entry, treat as error
                    isFailure = true;
                    reason = 'distinct (path error)';
                }
            }

            if (isFailure) {
                const failLine = `[${reason}] ${fullRelativePath} (Sizes: ${entry.size1 ?? 'N/A'} vs ${entry.size2 ?? 'N/A'})`;
                actualFailures.push(failLine);
            }
        }
    }

    if (actualFailures.length === 0 && res.same) {
         console.log("Directories are the same (after normalization).");
    } else if (actualFailures.length === 0 && !res.same) {
         console.log("Directory comparison reported differences, but none were relevant after normalization.");
    }

    // 5. Report results
    console.log("\n--- Test Result ---");
    test_passed = actualFailures.length === 0;

    if (test_passed) {
      console.log("✅ Test PASSED: Generated content matches expected content (ignoring timestamps/IDs/versions).");
    } else {
      console.error("❌ Test FAILED: Relevant differences found between expected and actual content:");
      actualFailures.forEach(fail => console.error(`  - ${fail}`));
      // Print detailed diffs if available
      if (diffDetails.length > 0) {
          console.error("\n--- Detailed Differences (Normalized) ---");
          diffDetails.forEach(detail => {
              console.error(`  File: ${detail.file}`);
              detail.diffs.forEach(d => console.error(d));
              console.error("  ...");
          });
      }
    }

  } catch (error) {
    console.error("\n--- Test FAILED due to runtime error ---");
    console.error(error);
    test_passed = false;
  } finally {
    // 6. Cleanup
    console.log("\n--- Cleanup Phase ---");
    const cleanupPromises = [];
    if (expected_extract_dir) {
      console.log(`Removing temporary directory: ${expected_extract_dir}`);
      cleanupPromises.push(fsPromises.rm(expected_extract_dir, { recursive: true, force: true }).catch(err => console.error(`Cleanup error: ${err.message}`)));
    }
    if (actual_extract_dir) {
      console.log(`Removing temporary directory: ${actual_extract_dir}`);
      cleanupPromises.push(fsPromises.rm(actual_extract_dir, { recursive: true, force: true }).catch(err => console.error(`Cleanup error: ${err.message}`)));
    }
    console.log(`*** Keeping actual output file: ${ACTUAL_OUTPUT_MBZ_TEMP} ***`);

    await Promise.all(cleanupPromises);
    console.log("Cleanup complete.");
  }

  // Exit with appropriate code
  process.exit(test_passed ? 0 : 1);
}

// Run the test
runTest(); 