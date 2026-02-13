'use strict';

const fs = require('fs');
const path = require('path');
const xlsx = require('node-xlsx');

const HEADERS = ['Nr', 'Last Name', 'First Name', 'Content Pages', 'A5 (incl. cover)', 'A4 Pages', 'A4 Sheets', 'Margins Applied'];

/**
 * Generates page count summary files (TXT with CRLF + XLSX) in the pdfs/ directory.
 * Reads processed_files.json from each student directory to aggregate statistics.
 * Calculates A4 pages needed for saddle-stitch booklet printing.
 *
 * @param {string} outputDirectory - Base output directory (contains pages/, pdfs/)
 * @param {function} [sendLog=console.log] - Logging function
 * @returns {Promise<void>}
 */
async function generatePageCountSummary(outputDirectory, sendLog = console.log) {
    const pagesDir = path.join(outputDirectory, 'pages');
    const pdfsDir = path.join(outputDirectory, 'pdfs');

    if (!fs.existsSync(pagesDir)) {
        sendLog('[Summary] No pages directory found, skipping summary generation.');
        return;
    }

    // Collect per-student statistics
    const studentStats = [];
    const studentDirs = fs.readdirSync(pagesDir).filter(dir =>
        fs.statSync(path.join(pagesDir, dir)).isDirectory()
    );

    for (const studentDir of studentDirs) {
        const infoPath = path.join(pagesDir, studentDir, 'processed_files.json');
        if (!fs.existsSync(infoPath)) continue;

        try {
            const data = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
            if (!data || !Array.isArray(data.processedFiles)) continue;

            const totalPages = data.processedFiles.length;
            if (totalPages === 0) continue;

            const info = data.processedFiles[0]?.studentInfo || {};
            const totalA5Pages = totalPages + 1; // +1 for cover sheet
            const roundedTo4 = Math.ceil(totalA5Pages / 4) * 4;

            studentStats.push({
                lastName: info.lastName || studentDir,
                firstName: info.firstName || '',
                studentNumber: info.studentNumber || '',
                contentPages: totalPages,
                a5Pages: totalA5Pages,
                a4Pages: roundedTo4 / 2,
                a4Sheets: roundedTo4 / 4,
                marginsApplied: data.processedFiles.filter(f => f.marginApplied).length,
            });
        } catch (err) {
            sendLog(`[Summary] Warning: Could not read ${infoPath}: ${err.message}`);
        }
    }

    // Sort by last name (matches PDF numbering)
    studentStats.sort((a, b) =>
        (a.lastName || '').localeCompare(b.lastName || '', 'de', { numeric: true })
    );

    // Number them
    studentStats.forEach((s, i) => { s.number = String(i + 1).padStart(3, '0'); });

    // Calculate totals
    const totals = studentStats.reduce((acc, s) => {
        acc.contentPages += s.contentPages;
        acc.a4Pages += s.a4Pages;
        acc.a4Sheets += s.a4Sheets;
        acc.marginsApplied += s.marginsApplied;
        return acc;
    }, { contentPages: 0, a4Pages: 0, a4Sheets: 0, marginsApplied: 0 });

    // --- Generate TXT (CRLF line endings for Windows compatibility) ---
    const CRLF = '\r\n';
    const rows = studentStats.map(s => [
        s.number, s.lastName, s.firstName,
        String(s.contentPages), String(s.a5Pages), String(s.a4Pages), String(s.a4Sheets),
        String(s.marginsApplied),
    ]);

    // Calculate column widths
    const colWidths = HEADERS.map((h, i) => {
        const dataMax = rows.reduce((max, row) => Math.max(max, row[i].length), 0);
        return Math.max(h.length, dataMax);
    });

    const formatRow = (cols) => cols.map((c, i) => c.padEnd(colWidths[i])).join('  |  ');
    const separator = colWidths.map(w => '-'.repeat(w)).join('--+--');

    let txt = '';
    txt += formatRow(HEADERS) + CRLF;
    txt += separator + CRLF;
    for (const row of rows) {
        txt += formatRow(row) + CRLF;
    }
    txt += separator + CRLF;
    txt += CRLF;
    txt += `Total students:          ${studentStats.length}` + CRLF;
    txt += `Total content pages:     ${totals.contentPages}` + CRLF;
    txt += `Total A4 pages (sides):  ${totals.a4Pages}` + CRLF;
    txt += `Total A4 sheets (paper): ${totals.a4Sheets}` + CRLF;
    txt += `Pages with margins:      ${totals.marginsApplied}` + CRLF;

    const txtPath = path.join(pdfsDir, 'page-summary.txt');
    fs.writeFileSync(txtPath, txt);
    sendLog(`[Summary] Written ${txtPath}`);

    // --- Generate XLSX ---
    const xlsxRows = studentStats.map(s => [
        parseInt(s.number), s.lastName, s.firstName,
        s.contentPages, s.a5Pages, s.a4Pages, s.a4Sheets,
        s.marginsApplied,
    ]);

    xlsxRows.push([]);
    xlsxRows.push(['', 'TOTAL', '', totals.contentPages, '', totals.a4Pages, totals.a4Sheets, totals.marginsApplied]);

    const xlsxData = [HEADERS, ...xlsxRows];
    const xlsxBuffer = xlsx.build([{ name: 'Page Summary', data: xlsxData }]);
    const xlsxPath = path.join(pdfsDir, 'page-summary.xlsx');
    fs.writeFileSync(xlsxPath, xlsxBuffer);
    sendLog(`[Summary] Written ${xlsxPath}`);
}

module.exports = { generatePageCountSummary };
