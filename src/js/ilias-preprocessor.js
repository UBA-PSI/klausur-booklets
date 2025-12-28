/**
 * ILIAS ZIP Preprocessor Module
 *
 * Converts ILIAS ZIP export structure to Moodle-compatible directory structure.
 * Supports two ILIAS export formats:
 *
 * 1. PER-ASSIGNMENT FORMAT (Export per Exercise/Assignment):
 *    One ZIP file per exercise containing all students' submissions.
 *    Use when you have fewer exercises than students (typical case).
 *
 *    Input Directory:
 *      ├── Seite 2.zip        (contains all students for exercise 2)
 *      ├── Seite 3.zip        (contains all students for exercise 3)
 *      └── Seite 4.zip        (contains all students for exercise 4)
 *
 *    Inside each ZIP (e.g., Seite 2.zip):
 *      Seite 2/
 *      └── Abgaben/
 *          ├── Lastname_Firstname_username_studentnumber/
 *          │   └── submission.pdf
 *          ├── Another_Student_user_12345/
 *          │   └── submission.pdf
 *          └── ...
 *
 * 2. PER-STUDENT FORMAT (Export per Participant):
 *    One ZIP file per student containing all their assignments.
 *    Use when you have fewer students than exercises (less common).
 *    Requires downloading each student individually from ILIAS.
 *
 *    Input Directory:
 *      ├── Lastname_Firstname_username_studentnumber.zip  (student 1, all exercises)
 *      ├── Another_Student_user_12345.zip                 (student 2, all exercises)
 *      └── ...
 *
 *    Inside each ZIP (e.g., Lastname_Firstname_username_studentnumber.zip):
 *      Lastname_Firstname_username_studentnumber/
 *      ├── Seite 2/
 *      │   └── Abgaben/
 *      │       └── Lastname_Firstname_username_studentnumber/
 *      │           └── submission.pdf
 *      ├── Seite 3/
 *      │   └── Abgaben/
 *      │       └── Lastname_Firstname_username_studentnumber/
 *      │           └── submission.pdf
 *      └── ...
 *
 * OUTPUT (Moodle-compatible, same for both formats):
 *   Temp Directory/
 *   ├── Seite 2/
 *   │   ├── Lastname_Firstname_username_studentnumber/
 *   │   │   └── submission.pdf
 *   │   ├── Another_Student_user_12345/
 *   │   │   └── submission.pdf
 *   │   └── ...
 *   ├── Seite 3/
 *   │   └── ...
 *   └── Seite 4/
 *       └── ...
 *
 * The module automatically detects which format is being used by analyzing
 * the ZIP filenames against the configured folder pattern.
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

/**
 * Detects if the input directory contains ILIAS ZIP files.
 * ILIAS mode is detected when:
 * - Directory contains at least one ZIP file
 * - Directory contains NO subdirectories (distinguishes from Moodle structure)
 * - Hidden files (like .DS_Store) are ignored
 *
 * @param {string} inputDir - Path to input directory
 * @returns {boolean} - true if ILIAS ZIP mode detected, false otherwise
 */
function detectIliasZipMode(inputDir) {
    try {
        // 1. Validate directory exists
        if (!fs.existsSync(inputDir)) {
            console.log(`ILIAS Detection: Directory does not exist: ${inputDir}`);
            return false;
        }

        const stats = fs.statSync(inputDir);
        if (!stats.isDirectory()) {
            console.log(`ILIAS Detection: Path is not a directory: ${inputDir}`);
            return false;
        }

        // 2. List all items in directory
        const items = fs.readdirSync(inputDir);

        if (items.length === 0) {
            console.log('ILIAS Detection: Directory is empty');
            return false;
        }

        // 3. Categorize items: ZIP files, subdirectories, other files
        const zipFiles = [];
        const subdirectories = [];
        const otherFiles = [];

        items.forEach(item => {
            // Skip hidden files (starting with .)
            if (item.startsWith('.')) {
                return;
            }

            const fullPath = path.join(inputDir, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                subdirectories.push(item);
            } else if (item.toLowerCase().endsWith('.zip')) {
                zipFiles.push(item);
            } else {
                otherFiles.push(item);
            }
        });

        // 4. Decision logic:
        //    ILIAS mode = has ZIP files AND no subdirectories
        //    (Moodle structure has subdirectories like "Page 1/", "Page 2/")
        if (zipFiles.length > 0 && subdirectories.length === 0) {
            if (otherFiles.length > 0) {
                console.log(`ILIAS Detection: Found non-ZIP files (${otherFiles.join(', ')}), ignoring them`);
            }
            console.log(`✓ ILIAS ZIP mode detected: ${zipFiles.length} ZIP file(s) found`);
            return true;
        }

        console.log(`ILIAS Detection: Not ILIAS mode (${zipFiles.length} ZIPs, ${subdirectories.length} subdirs, ${otherFiles.length} other files)`);
        return false;

    } catch (error) {
        console.error(`ILIAS Detection Error: ${error.message}`);
        return false;
    }
}

/**
 * Detects ILIAS export format by analyzing ZIP filenames.
 *
 * Logic:
 * - Per-Student: ZIP names match the student folder pattern
 *   (e.g., "Lastname_Firstname_username_123456.zip")
 * - Per-Assignment: ZIP names don't match the pattern
 *   (e.g., "Seite 2.zip", "Exercise 3.zip")
 *
 * @param {string[]} zipFiles - Array of ZIP file paths
 * @param {string} folderPattern - Student folder pattern from config (e.g., "FIRSTNAME_LASTNAME_USERNAME_STUDENTNUMBER")
 * @returns {string} - 'per-student' or 'per-assignment'
 */
function detectIliasFormat(zipFiles, folderPattern) {
    if (!folderPattern || zipFiles.length === 0) {
        return 'per-assignment'; // Default fallback
    }

    // Detect separator used in the pattern
    // Common patterns: "FIRSTNAME_LASTNAME_USERNAME_STUDENTNUMBER" (underscore)
    //                  "FIRSTNAME-LASTNAME-USERNAME-STUDENTNUMBER" (hyphen)
    let separator = '_';
    if (folderPattern.includes('-')) {
        separator = '-';
    }

    // Count how many parts the pattern has
    // Example: "FIRSTNAME_LASTNAME_USERNAME_STUDENTNUMBER" → 4 parts
    const patternParts = folderPattern.split(separator);
    const expectedPartCount = patternParts.length;

    // Sample first few ZIP files to determine format
    // (no need to check all files if there are many)
    const samplesToCheck = Math.min(3, zipFiles.length);
    let matchCount = 0;

    for (let i = 0; i < samplesToCheck; i++) {
        const zipName = path.basename(zipFiles[i], '.zip');
        const nameParts = zipName.split(separator);

        // If ZIP name has same structure as student pattern, it's per-student format
        // Example: "Schmidt_Anna_aschmidt_123456" has 4 parts → matches 4-part pattern
        if (nameParts.length === expectedPartCount) {
            matchCount++;
        }
    }

    // If majority of sampled ZIPs match the pattern, it's per-student format
    const isPerStudent = matchCount >= (samplesToCheck / 2);

    return isPerStudent ? 'per-student' : 'per-assignment';
}

/**
 * Preprocesses ILIAS ZIP files into Moodle-compatible structure.
 *
 * This is the main entry point for ILIAS ZIP processing. It:
 * 1. Creates a temporary directory
 * 2. Detects the ILIAS export format (per-student or per-assignment)
 * 3. Extracts and restructures all ZIP files accordingly
 * 4. Produces a Moodle-compatible directory structure that can be processed by the main tool
 *
 * @param {string} inputDir - Directory containing ILIAS ZIP files
 * @param {string} tempDir - Temporary directory for output (will be created if it doesn't exist)
 * @param {Function} logCallback - Callback for logging messages (default: console.log)
 * @param {string} folderPattern - Student folder pattern from settings (e.g., "FIRSTNAME_LASTNAME_USERNAME_STUDENTNUMBER")
 * @throws {Error} If all ZIP files fail to process or if preprocessing fails critically
 */
async function preprocessIliasZips(inputDir, tempDir, logCallback = console.log, folderPattern = null) {
    try {
        // 1. Create temp directory
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
            logCallback(`Created temporary directory: ${tempDir}`);
        }

        // 2. Get all ZIP files
        const zipFiles = fs.readdirSync(inputDir)
            .filter(f => f.toLowerCase().endsWith('.zip'))
            .map(f => path.join(inputDir, f))
            .sort((a, b) => {
                // Natural sort to handle numeric ordering (Seite 1, Seite 2, Seite 10, Seite 11)
                // This ensures correct page order in the final booklet
                const nameA = path.basename(a, '.zip');
                const nameB = path.basename(b, '.zip');
                return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
            });

        logCallback(`Processing ${zipFiles.length} ILIAS ZIP file(s)...`);

        // 3. Detect ILIAS format: Per-Assignment or Per-Student
        const format = detectIliasFormat(zipFiles, folderPattern);
        logCallback(`Detected ILIAS format: ${format}`);

        // 4. Process each ZIP according to detected format
        let successCount = 0;
        let errorCount = 0;

        for (const zipPath of zipFiles) {
            try {
                if (format === 'per-student') {
                    await extractAndRestructurePerStudentZip(zipPath, tempDir, logCallback);
                } else {
                    await extractAndRestructurePerAssignmentZip(zipPath, tempDir, logCallback);
                }
                successCount++;
            } catch (zipError) {
                errorCount++;
                logCallback(`ERROR processing ${path.basename(zipPath)}: ${zipError.message}`);
            }
        }

        logCallback(`ILIAS preprocessing complete: ${successCount} successful, ${errorCount} errors`);

        if (errorCount > 0 && successCount === 0) {
            throw new Error('All ILIAS ZIP files failed to process');
        }

        // 5. Ensure all page/assignment directories exist (for missing pages detection)
        // Even if a student didn't submit for a particular page, the page directory should exist
        // This makes the structure truly Moodle-compatible where all page folders always exist
        if (format === 'per-assignment') {
            // In per-assignment mode, each ZIP represents a page/assignment
            // Create empty directories for all ZIP files, even if extraction failed or was skipped
            for (const zipPath of zipFiles) {
                const pageName = path.basename(zipPath, '.zip');
                const pageDir = path.join(tempDir, pageName);

                if (!fs.existsSync(pageDir)) {
                    fs.mkdirSync(pageDir, { recursive: true });
                    logCallback(`  Created empty directory for page: ${pageName}`);
                }
            }
        }
        // Note: In per-student mode, all page directories are automatically created
        // during extraction since each student ZIP contains all assignment folders (even empty ones)

    } catch (error) {
        throw new Error(`ILIAS preprocessing failed: ${error.message}`);
    }
}

/**
 * Extracts and restructures a single ILIAS ZIP file (Per-Assignment format).
 *
 * Input ZIP structure:
 *   Seite 2.zip/
 *   └── Seite 2/
 *       └── Abgaben/
 *           ├── Student_A/
 *           │   └── file.pdf
 *           └── Student_B/
 *               └── file.pdf
 *
 * Output structure:
 *   tempDir/Seite 2/
 *   ├── Student_A/
 *   │   └── file.pdf
 *   └── Student_B/
 *       └── file.pdf
 *
 * @param {string} zipPath - Path to the ZIP file to process
 * @param {string} tempDir - Temporary output directory
 * @param {Function} logCallback - Callback for logging messages
 * @throws {Error} If ZIP extraction fails or if no "Abgaben" directory is found
 */
async function extractAndRestructurePerAssignmentZip(zipPath, tempDir, logCallback = console.log) {
    const zipName = path.basename(zipPath, '.zip'); // e.g., "Seite 2"

    logCallback(`  Processing: ${zipName}.zip`);

    try {
        // 1. Load ZIP file
        const zip = new AdmZip(zipPath);
        const zipEntries = zip.getEntries();

        // 2. Find the "Abgaben" directory pattern
        // Expected structure: "Seite X/Abgaben/Student_Folders/..."
        // We need to be flexible with the top-level folder name

        let abgabenPrefix = null;

        // Search for "Abgaben" directory in ZIP entries
        for (const entry of zipEntries) {
            const entryPath = entry.entryName;

            // Look for pattern: */Abgaben/
            if (entryPath.includes('/Abgaben/')) {
                const parts = entryPath.split('/');
                const abgabenIndex = parts.indexOf('Abgaben');

                if (abgabenIndex >= 0) {
                    // Build prefix up to and including "Abgaben/"
                    abgabenPrefix = parts.slice(0, abgabenIndex + 1).join('/') + '/';
                    break;
                }
            }
        }

        if (!abgabenPrefix) {
            logCallback(`  WARNING: No "Abgaben" directory found in ${zipName}.zip, skipping`);
            return;
        }

        logCallback(`  Found Abgaben path: ${abgabenPrefix}`);

        // 3. Create target page directory (Moodle-style)
        const targetPageDir = path.join(tempDir, zipName);
        if (!fs.existsSync(targetPageDir)) {
            fs.mkdirSync(targetPageDir, { recursive: true });
        }

        // 4. Extract student submissions
        let studentCount = 0;
        let fileCount = 0;

        for (const entry of zipEntries) {
            const entryPath = entry.entryName;

            // Only process files inside "Abgaben/" directory
            if (entryPath.startsWith(abgabenPrefix) && !entry.isDirectory) {
                // Extract relative path after "Abgaben/"
                const relativePath = entryPath.substring(abgabenPrefix.length);

                // Skip files directly in Abgaben/ (like .xlsx files)
                if (!relativePath.includes('/')) {
                    continue;
                }

                // Build target path
                const targetPath = path.join(targetPageDir, relativePath);
                const targetDirPath = path.dirname(targetPath);

                // Create directory structure
                if (!fs.existsSync(targetDirPath)) {
                    fs.mkdirSync(targetDirPath, { recursive: true });
                }

                // Extract file
                fs.writeFileSync(targetPath, entry.getData());
                fileCount++;

                // Count unique student folders
                const studentFolder = relativePath.split('/')[0];
                if (studentFolder) {
                    studentCount++;
                }
            }
        }

        // Remove duplicates from student count
        const uniqueStudents = new Set();
        if (fs.existsSync(targetPageDir)) {
            const folders = fs.readdirSync(targetPageDir);
            folders.forEach(folder => {
                const folderPath = path.join(targetPageDir, folder);
                if (fs.statSync(folderPath).isDirectory()) {
                    uniqueStudents.add(folder);
                }
            });
        }

        logCallback(`  ✓ Extracted ${uniqueStudents.size} student submission(s) with ${fileCount} file(s)`);

    } catch (error) {
        throw new Error(`Failed to extract ${zipName}.zip: ${error.message}`);
    }
}

/**
 * Extracts and restructures a single ILIAS ZIP file (Per-Student format).
 *
 * Input ZIP structure:
 *   Student_Name.zip/
 *   └── Student_Name/
 *       ├── Seite 2/
 *       │   └── Abgaben/
 *       │       └── Student_Name/
 *       │           └── file1.pdf
 *       └── Seite 3/
 *           └── Abgaben/
 *               └── Student_Name/
 *                   └── file2.pdf
 *
 * Output structure:
 *   tempDir/Seite 2/
 *   │   └── Student_Name/
 *   │       └── file1.pdf
 *   tempDir/Seite 3/
 *       └── Student_Name/
 *           └── file2.pdf
 *
 * @param {string} zipPath - Path to the ZIP file to process
 * @param {string} tempDir - Temporary output directory
 * @param {Function} logCallback - Callback for logging messages
 * @throws {Error} If ZIP extraction fails or if no assignment directories are found
 */
async function extractAndRestructurePerStudentZip(zipPath, tempDir, logCallback = console.log) {
    const zipName = path.basename(zipPath, '.zip'); // e.g., "Lastname_Firstname_username_123456"

    logCallback(`  Processing per-student: ${zipName}.zip`);

    try {
        // 1. Load ZIP file
        const zip = new AdmZip(zipPath);
        const zipEntries = zip.getEntries();

        // 2. Find all assignment directories (e.g., "Seite 1", "Seite 2", ...)
        // Structure: Student_Name/Seite X/Abgaben/Student_Name/files
        // IMPORTANT: We need to capture ALL assignment directories, even empty ones
        // (when student didn't submit anything for that assignment)
        const assignmentDirs = new Set();

        for (const entry of zipEntries) {
            const entryPath = entry.entryName;
            const parts = entryPath.split('/');

            // Look for pattern: [StudentName]/[AssignmentName]/...
            // parts[0] = student name folder, parts[1] = assignment folder
            if (parts.length >= 2 && parts[1]) {
                // Check if this is an assignment directory (has "Abgaben" or other subdirs)
                // We look for any second-level directory that's not empty
                if (parts.length >= 3) {
                    assignmentDirs.add(parts[1]); // e.g., "Seite 2", "Exercise 1", etc.
                }
            }
        }

        if (assignmentDirs.size === 0) {
            logCallback(`  WARNING: No assignment directories found in ${zipName}.zip, skipping`);
            return;
        }

        logCallback(`  Found ${assignmentDirs.size} assignment(s) for student ${zipName}`);

        let fileCount = 0;

        // 3. Process each assignment
        for (const assignmentName of assignmentDirs) {
            // Create target assignment directory in Moodle-style: tempDir/Seite X/
            const targetAssignmentDir = path.join(tempDir, assignmentName);
            if (!fs.existsSync(targetAssignmentDir)) {
                fs.mkdirSync(targetAssignmentDir, { recursive: true });
            }

            // Create student folder inside assignment: tempDir/Seite X/Student_Name/
            const targetStudentDir = path.join(targetAssignmentDir, zipName);
            if (!fs.existsSync(targetStudentDir)) {
                fs.mkdirSync(targetStudentDir, { recursive: true });
            }

            // 4. Extract files for this assignment
            // Look for: Student_Name/Assignment_Name/Abgaben/Student_Name/file.pdf
            const abgabenPrefix = `${zipName}/${assignmentName}/Abgaben/${zipName}/`;

            for (const entry of zipEntries) {
                const entryPath = entry.entryName;

                if (entryPath.startsWith(abgabenPrefix) && !entry.isDirectory) {
                    // Get filename after the Abgaben/Student_Name/ prefix
                    const fileName = entryPath.substring(abgabenPrefix.length);

                    // Skip if empty or contains subdirectories
                    if (!fileName || fileName.includes('/')) {
                        continue;
                    }

                    // Write file to: tempDir/Seite X/Student_Name/file.pdf
                    const targetPath = path.join(targetStudentDir, fileName);
                    fs.writeFileSync(targetPath, entry.getData());
                    fileCount++;
                }
            }
        }

        logCallback(`  ✓ Extracted ${fileCount} file(s) across ${assignmentDirs.size} assignment(s) for ${zipName}`);

    } catch (error) {
        throw new Error(`Failed to extract per-student ZIP ${zipName}.zip: ${error.message}`);
    }
}

/**
 * Cleans up the temporary directory created during ILIAS preprocessing.
 *
 * @param {string} tempDir - Path to the temporary directory to remove
 * @returns {boolean} - true if cleanup was successful, false otherwise
 */
function cleanupTempDirectory(tempDir) {
    try {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            console.log(`Cleaned up temporary directory: ${tempDir}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`Failed to cleanup temp directory ${tempDir}: ${error.message}`);
        return false;
    }
}

// Export public API
module.exports = {
    detectIliasZipMode,        // Detects if input directory contains ILIAS ZIP files
    preprocessIliasZips,        // Main preprocessing function
    cleanupTempDirectory        // Cleanup utility
};
