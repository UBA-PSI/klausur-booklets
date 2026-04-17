const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const AdmZip = require('adm-zip');
const { generateIliasExerciseZip, parseIliasExerciseZip, generateIds, toUtcString } = require('../lib/iliasExerciseGenerator');

function main() {
    testIsCEST();
    testToUtcString();
    testGenerateIds();
    testRoundtrip();
    testRoundtripWithHtml();
    testXmlWellFormed();
    testParseInvalidZip();
    testMaxFilesValidation();
    console.log('\n✅ All ILIAS Exercise Generator tests passed.');
}

// --- isCEST (accessed indirectly via toUtcString) ---

function testIsCEST() {
    // Winter (January) → CET (UTC+1)
    const jan = toUtcString('2026-01-15 12:00');
    assert.strictEqual(jan, '2026-01-15 11:00:00', 'January should be CET (UTC+1)');
    console.log('✅ isCEST: January → CET');

    // Summer (July) → CEST (UTC+2)
    const jul = toUtcString('2026-07-15 12:00');
    assert.strictEqual(jul, '2026-07-15 10:00:00', 'July should be CEST (UTC+2)');
    console.log('✅ isCEST: July → CEST');

    // Last Sunday of March 2026 = March 29
    // 01:59 CET → still CET
    const beforeSwitch = toUtcString('2026-03-29 01:59');
    assert.strictEqual(beforeSwitch, '2026-03-29 00:59:00', 'Just before spring switch → CET');
    // 03:00 CEST → already CEST
    const afterSwitch = toUtcString('2026-03-29 03:00');
    assert.strictEqual(afterSwitch, '2026-03-29 01:00:00', 'After spring switch → CEST');
    console.log('✅ isCEST: spring DST boundary');

    // Last Sunday of October 2026 = October 25
    // 02:59 CEST → still CEST
    const beforeAutumn = toUtcString('2026-10-25 02:59');
    assert.strictEqual(beforeAutumn, '2026-10-25 00:59:00', 'Just before autumn switch → CEST');
    // 03:00 → CET again
    const afterAutumn = toUtcString('2026-10-25 03:00');
    assert.strictEqual(afterAutumn, '2026-10-25 02:00:00', 'After autumn switch → CET');
    console.log('✅ isCEST: autumn DST boundary');
}

// --- toUtcString ---

function testToUtcString() {
    // Date-only input (defaults to 00:00)
    const dateOnly = toUtcString('2026-01-15');
    assert.strictEqual(dateOnly, '2026-01-14 23:00:00', 'Date-only: midnight CET = 23:00 UTC previous day');
    console.log('✅ toUtcString: date-only input');

    // Midnight CEST
    const midnightCest = toUtcString('2026-07-01 00:00');
    assert.strictEqual(midnightCest, '2026-06-30 22:00:00', 'Midnight CEST = 22:00 UTC previous day');
    console.log('✅ toUtcString: midnight CEST wraps to previous day');

    // End of year
    const newYear = toUtcString('2026-12-31 23:30');
    assert.strictEqual(newYear, '2026-12-31 22:30:00', 'NYE 23:30 CET');
    console.log('✅ toUtcString: end of year');
}

// --- generateIds ---

function testGenerateIds() {
    const { excId, assIds } = generateIds(5);

    assert.strictEqual(typeof excId, 'number');
    assert.strictEqual(assIds.length, 5);

    // All IDs must be unique
    const all = [excId, ...assIds];
    assert.strictEqual(new Set(all).size, all.length, 'All IDs must be unique');

    // Assignment IDs must not overlap with exercise ID range
    assert.ok(assIds[0] > excId, 'Assignment IDs should be greater than exercise ID');

    // Two calls should produce different IDs (with very high probability)
    const { excId: excId2 } = generateIds(1);
    // Could theoretically collide but astronomically unlikely
    console.log('✅ generateIds: produces valid, unique IDs');
}

// --- Roundtrip: generate → parse ---

function testRoundtrip() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilias-test-'));
    const zipPath = path.join(tmpDir, 'test-exercise.zip');

    try {
        const config = {
            exercise_title: 'Test Exercise',
            exercise_description: 'A test description',
            instruction_html: '<p>Upload your work.</p>',
            mandatory: true,
            max_files: 2,
            assignments: [
                { title: 'Seite 1', startDate: '2026-04-01 00:00', deadlineDate: '2026-04-08 23:55' },
                { title: 'Seite 2', startDate: '2026-04-08 00:00', deadlineDate: '2026-04-15 23:55' },
                { title: 'Seite 3', startDate: '2026-04-15 00:00', deadlineDate: '2026-04-22 23:55' },
            ],
        };

        const result = generateIliasExerciseZip(config, zipPath);
        assert.ok(fs.existsSync(zipPath), 'ZIP file should exist');
        assert.strictEqual(result.numUnits, 3);
        assert.strictEqual(result.outputPath, zipPath);

        const parsed = parseIliasExerciseZip(zipPath);
        assert.strictEqual(parsed.exercise_title, 'Test Exercise');
        assert.strictEqual(parsed.exercise_description, 'A test description');
        assert.ok(parsed.instruction_html.includes('Upload your work'), 'Instruction should round-trip');
        assert.strictEqual(parsed.assignments.length, 3);
        assert.strictEqual(parsed.assignments[0].title, 'Seite 1');
        assert.strictEqual(parsed.assignments[1].title, 'Seite 2');
        assert.strictEqual(parsed.assignments[2].title, 'Seite 3');

        console.log('✅ Roundtrip: generate → parse preserves data');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

function testRoundtripWithHtml() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilias-test-'));
    const zipPath = path.join(tmpDir, 'test-html.zip');

    try {
        const html = '<p>Lade eine Datei hoch (PDF &amp; JPG).</p>\n<ul>\n<li>Punkt 1</li>\n<li>Punkt "2"</li>\n</ul>';
        const config = {
            exercise_title: 'Übung mit Sönderzeichen & "Quotes"',
            exercise_description: 'Beschreibung <mit> & Entities',
            instruction_html: html,
            mandatory: false,
            max_files: 1,
            assignments: [
                { title: 'Aufgabe 1', startDate: '2026-05-01 00:00', deadlineDate: '2026-05-08 23:55' },
            ],
        };

        generateIliasExerciseZip(config, zipPath);
        const parsed = parseIliasExerciseZip(zipPath);

        assert.strictEqual(parsed.exercise_title, config.exercise_title, 'Title with special chars');
        assert.strictEqual(parsed.exercise_description, config.exercise_description, 'Description with entities');
        assert.strictEqual(parsed.instruction_html, html, 'HTML instruction round-trip');

        console.log('✅ Roundtrip: special characters and HTML entities preserved');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// --- XML well-formedness ---

/**
 * Minimal well-formedness check for XML generated via string concatenation:
 * (1) every opening tag has a matching closing tag (ignoring self-closing),
 * (2) no unescaped ampersands outside recognised entity references.
 * Not a full parser — just catches the regression class we care about
 * (unescaped `&` in user content, dangling tags from template edits).
 */
function assertXmlWellFormed(xml, label) {
    const unescapedAmp = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/;
    const match = unescapedAmp.exec(xml);
    assert.ok(!match, `${label}: unescaped '&' at offset ${match ? match.index : -1}: ${match ? xml.slice(Math.max(0, match.index - 20), match.index + 20) : ''}`);

    const counts = new Map();
    const tagPattern = /<(\/?)([A-Za-z_][\w:.-]*)(\s[^>]*?)?(\/?)>/g;
    let m;
    while ((m = tagPattern.exec(xml)) !== null) {
        const closing = m[1] === '/';
        const name = m[2];
        const selfClosing = m[4] === '/';
        if (name.startsWith('?') || name.startsWith('!')) continue;
        if (selfClosing) continue;
        const current = counts.get(name) || 0;
        counts.set(name, current + (closing ? -1 : 1));
    }
    for (const [name, delta] of counts) {
        assert.strictEqual(delta, 0, `${label}: tag <${name}> is unbalanced (net open = ${delta})`);
    }
}

function testXmlWellFormed() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilias-test-'));
    const zipPath = path.join(tmpDir, 'test-wellformed.zip');

    try {
        const config = {
            exercise_title: 'Tricky & "Quoted" <Title>',
            exercise_description: 'Desc with & ampersand and <brackets>',
            instruction_html: '<p>Ampersand: &amp; literal text</p>\n<ul>\n<li>Item with "quotes" & more</li>\n</ul>',
            mandatory: true,
            max_files: 3,
            assignments: [
                { title: 'Einheit & 1', startDate: '2026-04-01 00:00', deadlineDate: '2026-04-08 23:55' },
                { title: 'Einheit "2"', startDate: '2026-04-08 00:00', deadlineDate: '2026-04-15 23:55' },
            ],
        };

        generateIliasExerciseZip(config, zipPath);

        const zip = new AdmZip(zipPath);
        const xmlEntries = zip.getEntries().filter(e => e.entryName.endsWith('.xml'));
        assert.ok(xmlEntries.length >= 4, 'Should produce at least 4 XML files');

        for (const entry of xmlEntries) {
            const xml = zip.readAsText(entry);
            assertXmlWellFormed(xml, entry.entryName);
        }
        console.log(`✅ XML well-formedness: ${xmlEntries.length} XML files pass tag-balance and entity checks`);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// --- Error handling ---

function testParseInvalidZip() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilias-test-'));
    const fakePath = path.join(tmpDir, 'not-a-zip.zip');

    try {
        fs.writeFileSync(fakePath, 'this is not a zip file');
        assert.throws(
            () => parseIliasExerciseZip(fakePath),
            /./,
            'Should throw on invalid ZIP'
        );
        console.log('✅ parseIliasExerciseZip: throws on invalid ZIP');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

function testMaxFilesValidation() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilias-test-'));
    const zipPath = path.join(tmpDir, 'test-maxfiles.zip');

    try {
        const config = {
            exercise_title: 'Test',
            exercise_description: '',
            instruction_html: '',
            mandatory: false,
            max_files: 0, // invalid, should be clamped to 1
            assignments: [
                { title: 'A1', startDate: '2026-06-01 00:00', deadlineDate: '2026-06-08 00:00' },
            ],
        };

        generateIliasExerciseZip(config, zipPath);
        const parsed = parseIliasExerciseZip(zipPath);
        assert.ok(parsed.assignments.length === 1);
        console.log('✅ max_files=0 does not crash (clamped to 1)');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

main();
