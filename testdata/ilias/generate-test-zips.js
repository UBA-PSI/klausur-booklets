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

// Students with umlauts for edge case testing
const STUDENTS_UMLAUTS = [
    { firstname: 'Anna', lastname: 'Müller', username: 'amueller', number: '801234' },
    { firstname: 'Max', lastname: 'Schäfer', username: 'mschaefer', number: '802345' },
    { firstname: 'Lisa', lastname: 'Löwe', username: 'lloewe', number: '803456' }
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
    },
    'edge-cases-umlauts': {
        pages: ['Seite 1', 'Seite 2'],
        missingSubmissions: {
            'Seite 2': ['amueller'] // Anna Müller missing Seite 2
        },
        useUmlautStudents: true
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

    const { pages, missingSubmissions, useUmlautStudents } = testCase;
    const studentList = useUmlautStudents ? STUDENTS_UMLAUTS : STUDENTS;

    for (const pageName of pages) {
        console.log(`  Creating ${pageName}.zip`);
        const zip = new AdmZip();

        // Create PDF for this page
        const pdfBytes = await createPagePDF(pageName);

        // Add submissions for each student (unless missing)
        const missingStudents = missingSubmissions[pageName] || [];

        for (const student of studentList) {
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
 * Generates edge case test ZIPs
 */
async function generateEdgeCaseZips(outputDir) {
    console.log(`\nGenerating Edge Cases: ${outputDir}`);

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // 1. Umlauts test
    await generatePerAssignmentZips(
        path.join(outputDir, 'umlauts'),
        TEST_CASES['edge-cases-umlauts']
    );

    // 2. Empty ZIP (completely empty)
    console.log('  Creating empty.zip (completely empty)');
    const emptyZip = new AdmZip();
    emptyZip.writeZip(path.join(outputDir, 'empty.zip'));

    // 3. Corrupt ZIP (invalid ZIP data)
    console.log('  Creating corrupt.zip (invalid ZIP file)');
    fs.writeFileSync(path.join(outputDir, 'corrupt.zip'), 'This is not a valid ZIP file content');

    // 4. Mixed file types (PDFs + images with special characters in filenames)
    console.log('  Creating Seite 1 - Special Files.zip (mixed file types, special chars in name)');
    const mixedZip = new AdmZip();
    const pdfBytes = await createPagePDF('Seite 1');

    // Create a simple 1x1 PNG image
    const pngData = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 px
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
        0x42, 0x60, 0x82
    ]);

    const studentName = 'Müller_Anna_amueller_801234';

    // Add PDF with normal name
    mixedZip.addFile(
        `Seite 1 - Special Files/Abgaben/${studentName}/submission.pdf`,
        Buffer.from(pdfBytes)
    );

    // Add image with special characters in filename
    mixedZip.addFile(
        `Seite 1 - Special Files/Abgaben/${studentName}/scan übung 1 (final).png`,
        pngData
    );

    // Add JPEG (minimal valid JPEG)
    const jpegData = Buffer.from([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
        0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
        0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9
    ]);

    mixedZip.addFile(
        `Seite 1 - Special Files/Abgaben/${studentName}/photo-2.jpg`,
        jpegData
    );

    mixedZip.writeZip(path.join(outputDir, 'Seite 1 - Special Files.zip'));

    console.log(`✓ Created edge case test files in ${outputDir}`);
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

        // Generate Edge Cases
        await generateEdgeCaseZips(
            path.join(baseDir, 'edge-cases')
        );

        console.log('\n=== Test ZIP Generation Complete ===');
        console.log('\nGenerated test directories:');
        console.log('  - testdata/ilias/per-assignment/');
        console.log('  - testdata/ilias/per-assignment-alt-names/');
        console.log('  - testdata/ilias/per-student/');
        console.log('  - testdata/ilias/edge-cases/');
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
        console.log('\nEdge Cases:');
        console.log('  - Umlauts: Anna Müller should have missing: Seite 2');
        console.log('  - Empty ZIP should be handled gracefully');
        console.log('  - Corrupt ZIP should be handled gracefully');
        console.log('  - Mixed file types (PDF, PNG, JPEG) should all be extracted');

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
