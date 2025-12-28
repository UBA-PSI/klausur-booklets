#!/usr/bin/env node

/**
 * ILIAS Test ZIP Generator
 *
 * Generates test ZIP files for ILIAS format detection and preprocessing tests.
 * Creates PDFs with visible page numbers for easy verification of sorting.
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const AdmZip = require('adm-zip');

// Test configuration
const STUDENTS = [
    { firstname: 'Alice', lastname: 'Zephyr', username: 'azephyr', number: '901234' },
    { firstname: 'Bob', lastname: 'Quantum', username: 'bquantum', number: '902345' },
    { firstname: 'Charlie', lastname: 'Nexus', username: 'cnexus', number: '903456' }
];

const TEST_CASES = {
    'per-assignment': {
        pages: ['Seite 2', 'Seite 3', 'Seite 4', 'Seite 5', 'Seite 10'],
        missingSubmissions: {
            // Bob (Quantum) missing Seite 3
            'Seite 3': ['bquantum']
        }
    },
    'per-assignment-alt-names': {
        pages: ['Exercise 2', 'Exercise 3', 'Exercise 10', 'Aufgabe 1', 'Übung 5'],
        missingSubmissions: {
            // Alice missing Exercise 10
            'Exercise 10': ['azephyr'],
            // Charlie missing Übung 5
            'Übung 5': ['cnexus']
        }
    },
    'per-student': {
        pages: ['Seite 2', 'Seite 3', 'Seite 4', 'Seite 5', 'Seite 10'],
        missingSubmissions: {
            // Alice missing Seite 4
            'azephyr': ['Seite 4'],
            // Bob missing Seite 5 and Seite 10
            'bquantum': ['Seite 5', 'Seite 10']
        }
    }
};

/**
 * Creates a simple PDF with a large page number in the center
 */
async function createPagePDF(pageLabel) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 size

    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 120;

    // Draw page number in center
    const text = pageLabel;
    const textWidth = helveticaFont.widthOfTextAtSize(text, fontSize);
    const textHeight = fontSize;

    page.drawText(text, {
        x: (page.getWidth() - textWidth) / 2,
        y: (page.getHeight() - textHeight) / 2,
        size: fontSize,
        font: helveticaFont,
        color: rgb(0, 0, 0)
    });

    // Add small label at top
    page.drawText(`Test Page: ${pageLabel}`, {
        x: 50,
        y: page.getHeight() - 50,
        size: 12,
        font: helveticaFont,
        color: rgb(0.5, 0.5, 0.5)
    });

    return await pdfDoc.save();
}

/**
 * Generates student folder name from pattern
 */
function getStudentFolderName(student, pattern = 'LASTNAME_FIRSTNAME_USERNAME_STUDENTNUMBER') {
    return pattern
        .replace('FIRSTNAME', student.firstname)
        .replace('LASTNAME', student.lastname)
        .replace('USERNAME', student.username)
        .replace('STUDENTNUMBER', student.number);
}

/**
 * Generates Per-Assignment format test ZIPs
 */
async function generatePerAssignmentZips(outputDir, testCase) {
    console.log(`\nGenerating Per-Assignment format: ${outputDir}`);

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const { pages, missingSubmissions } = testCase;

    for (const pageName of pages) {
        console.log(`  Creating ${pageName}.zip`);
        const zip = new AdmZip();

        // Create PDF for this page
        const pdfBytes = await createPagePDF(pageName);

        // Add submissions for each student (unless missing)
        const missingStudents = missingSubmissions[pageName] || [];

        for (const student of STUDENTS) {
            if (missingStudents.includes(student.username)) {
                console.log(`    - Skipping ${student.firstname} ${student.lastname} (missing)`);
                continue;
            }

            const studentFolder = getStudentFolderName(student);
            const zipPath = `${pageName}/Abgaben/${studentFolder}/submission.pdf`;

            zip.addFile(zipPath, Buffer.from(pdfBytes));
            console.log(`    + Added ${student.firstname} ${student.lastname}`);
        }

        // Save ZIP file
        const zipPath = path.join(outputDir, `${pageName}.zip`);
        zip.writeZip(zipPath);
    }

    console.log(`✓ Created ${pages.length} ZIP files in ${outputDir}`);
}

/**
 * Generates Per-Student format test ZIPs
 */
async function generatePerStudentZips(outputDir, testCase) {
    console.log(`\nGenerating Per-Student format: ${outputDir}`);

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const { pages, missingSubmissions } = testCase;

    for (const student of STUDENTS) {
        const studentFolder = getStudentFolderName(student);
        console.log(`  Creating ${studentFolder}.zip`);

        const zip = new AdmZip();
        const missingPages = missingSubmissions[student.username] || [];

        // Add all pages (including empty ones for missing submissions)
        for (const pageName of pages) {
            const hasMissingSubmission = missingPages.includes(pageName);

            if (hasMissingSubmission) {
                // Create empty Abgaben directory
                const emptyDirPath = `${studentFolder}/${pageName}/Abgaben/.gitkeep`;
                zip.addFile(emptyDirPath, Buffer.from(''));
                console.log(`    - ${pageName} (empty - missing submission)`);
            } else {
                // Create PDF and add to ZIP
                const pdfBytes = await createPagePDF(pageName);
                const zipPath = `${studentFolder}/${pageName}/Abgaben/${studentFolder}/submission.pdf`;
                zip.addFile(zipPath, Buffer.from(pdfBytes));
                console.log(`    + ${pageName}`);
            }
        }

        // Save ZIP file
        const zipPath = path.join(outputDir, `${studentFolder}.zip`);
        zip.writeZip(zipPath);
    }

    console.log(`✓ Created ${STUDENTS.length} ZIP files in ${outputDir}`);
}

/**
 * Main execution
 */
async function main() {
    console.log('=== ILIAS Test ZIP Generator ===\n');

    const baseDir = path.join(__dirname);

    try {
        // Generate Per-Assignment test cases
        await generatePerAssignmentZips(
            path.join(baseDir, 'per-assignment'),
            TEST_CASES['per-assignment']
        );

        await generatePerAssignmentZips(
            path.join(baseDir, 'per-assignment-alt-names'),
            TEST_CASES['per-assignment-alt-names']
        );

        // Generate Per-Student test case
        await generatePerStudentZips(
            path.join(baseDir, 'per-student'),
            TEST_CASES['per-student']
        );

        console.log('\n=== Test ZIP Generation Complete ===');
        console.log('\nGenerated test directories:');
        console.log('  - testdata/ilias/per-assignment/');
        console.log('  - testdata/ilias/per-assignment-alt-names/');
        console.log('  - testdata/ilias/per-student/');
        console.log('\nExpected Results:');
        console.log('\nPer-Assignment (Seite X):');
        console.log('  - Bob Quantum should have missing: Seite 3');
        console.log('  - Sorting: Seite 2, 3, 4, 5, 10 (NOT 10, 2, 3, 4, 5)');
        console.log('\nPer-Assignment (Alternative Names):');
        console.log('  - Alice Zephyr should have missing: Exercise 10');
        console.log('  - Charlie Nexus should have missing: Übung 5');
        console.log('  - Sorting: Aufgabe 1, Exercise 2, 3, 10, Übung 5');
        console.log('\nPer-Student:');
        console.log('  - Alice Zephyr should have missing: Seite 4');
        console.log('  - Bob Quantum should have missing: Seite 5, 10');
        console.log('  - All ZIPs should contain all page folders (even empty ones)');

    } catch (error) {
        console.error('Error generating test ZIPs:', error);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = { createPagePDF, getStudentFolderName };
