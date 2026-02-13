#!/usr/bin/env node
/**
 * pdf-add-margins.js — Standalone tool for adding margins to existing A5 PDFs.
 *
 * Use this for post-hoc corrections on already-generated booklet PDFs.
 * Unlike the built-in pipeline margin enforcement (which works during the
 * transform stage on image buffers), this script operates on finished PDFs.
 *
 * How it works:
 *   1. Renders each page as a low-res PNG via Ghostscript (72 DPI, for analysis only)
 *   2. Checks edge pixels for non-white content (threshold: brightness < 240)
 *   3. Pages with content at edges: embedded and drawn scaled via pdf-lib (preserves original streams)
 *   4. Pages with sufficient margins: copied byte-for-byte via pdf-lib copyPages()
 *   -> File size is preserved (no re-encoding of image data)
 *
 * Requirements: Ghostscript (gs) must be installed and in PATH.
 *
 * Usage:
 *   node pdf-add-margins.js <input.pdf> [output.pdf]
 *
 * Examples:
 *   node pdf-add-margins.js student.pdf                    # -> student_margins.pdf
 *   node pdf-add-margins.js student.pdf out.pdf            # -> out.pdf
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

const MARGIN_H_MM = 3.5;  // horizontal margin (left/right)
const MARGIN_V_MM = 5.0;  // vertical margin (top/bottom)
const WHITE_THRESHOLD = 240; // pixel brightness below this = "content"

// Margin in PDF points (1 point = 1/72 inch)
const MARGIN_H_PT = MARGIN_H_MM / 25.4 * 72;
const MARGIN_V_PT = MARGIN_V_MM / 25.4 * 72;

/**
 * Analyzes a rendered page PNG to detect content within the margin zone.
 * @param {string} pngPath - Path to the rendered PNG file
 * @param {number} dpi - Rendering DPI (used to convert mm to pixels)
 * @returns {Promise<boolean>} True if content is found at the edges
 */
async function analyzePageMargins(pngPath, dpi) {
    const { data, info } = await sharp(pngPath)
        .raw()
        .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    const colorChannels = Math.min(channels, 3); // ignore alpha if present

    const marginHPx = Math.round(MARGIN_H_MM / 25.4 * dpi);
    const marginVPx = Math.round(MARGIN_V_MM / 25.4 * dpi);

    const isContent = (x, y) => {
        const idx = (y * width + x) * channels;
        for (let c = 0; c < colorChannels; c++) {
            if (data[idx + c] < WHITE_THRESHOLD) return true;
        }
        return false;
    };

    // Check left strip
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < marginHPx; x++) {
            if (isContent(x, y)) return true;
        }
    }
    // Check right strip
    for (let y = 0; y < height; y++) {
        for (let x = width - marginHPx; x < width; x++) {
            if (isContent(x, y)) return true;
        }
    }
    // Check top strip
    for (let y = 0; y < marginVPx; y++) {
        for (let x = 0; x < width; x++) {
            if (isContent(x, y)) return true;
        }
    }
    // Check bottom strip
    for (let y = height - marginVPx; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (isContent(x, y)) return true;
        }
    }

    return false;
}

function formatMB(bytes) {
    return (bytes / 1024 / 1024).toFixed(1);
}

async function run(inputPath, outputPath) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-margins-'));
    const dpi = 72;

    try {
        console.log('Rendering pages for margin analysis...');
        execFileSync('gs', [
            '-dBATCH', '-dNOPAUSE', '-dQUIET',
            '-sDEVICE=png16m', `-r${dpi}`,
            `-sOutputFile=${tmpDir}/page-%03d.png`,
            inputPath
        ]);

        const pngFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png')).sort();
        console.log(`Analyzing ${pngFiles.length} pages...\n`);

        const needsScale = [];
        for (const pngFile of pngFiles) {
            const hasEdgeContent = await analyzePageMargins(path.join(tmpDir, pngFile), dpi);
            needsScale.push(hasEdgeContent);
        }

        const srcData = fs.readFileSync(inputPath);
        const srcPdf = await PDFDocument.load(srcData);
        const outPdf = await PDFDocument.create();

        let scaledCount = 0;
        let copiedCount = 0;

        for (let i = 0; i < srcPdf.getPageCount(); i++) {
            const srcPage = srcPdf.getPage(i);
            const { width, height } = srcPage.getSize();

            if (needsScale[i]) {
                const scale = Math.min(
                    (width - 2 * MARGIN_H_PT) / width,
                    (height - 2 * MARGIN_V_PT) / height
                );
                const sw = width * scale;
                const sh = height * scale;

                const embedded = await outPdf.embedPage(srcPage);
                const newPage = outPdf.addPage([width, height]);
                newPage.drawPage(embedded, {
                    x: (width - sw) / 2,
                    y: (height - sh) / 2,
                    width: sw,
                    height: sh,
                });

                scaledCount++;
                console.log(`  Page ${i + 1}: SCALED (content within margin zone)`);
            } else {
                const [copied] = await outPdf.copyPages(srcPdf, [i]);
                outPdf.addPage(copied);
                copiedCount++;
                console.log(`  Page ${i + 1}: copied as-is`);
            }
        }

        const outData = await outPdf.save();
        fs.writeFileSync(outputPath, outData);

        console.log(`\n${scaledCount} scaled, ${copiedCount} unchanged`);
        console.log(`Input:  ${formatMB(fs.statSync(inputPath).size)} MB`);
        console.log(`Output: ${formatMB(outData.length)} MB -> ${outputPath}`);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// --- CLI ---
const input = process.argv[2];
const output = process.argv[3];

if (!input) {
    console.log('Usage: node pdf-add-margins.js <input.pdf> [output.pdf]');
    console.log(`Adds ${MARGIN_H_MM}mm horizontal / ${MARGIN_V_MM}mm vertical margins`);
    console.log('Only scales pages where content reaches the edge.');
    process.exit(1);
}

run(
    input,
    output || input.replace(/\.pdf$/i, '_margins.pdf')
).catch(err => {
    console.error(err);
    process.exit(1);
});
