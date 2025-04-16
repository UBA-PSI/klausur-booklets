#!/usr/bin/env node

const path = require('path');
const { main } = require('./src/js/pdf-cmdline-processor');

// Get test PDF path from command line or use default
const testPdfArg = process.argv[2];
const testPdf = testPdfArg || path.join('test-pdfs', 'Seite 1', 'Johannes Bauer_27128_assignsubmission_file_', 'Bauer_Johannes_Ethische Systemgestaltung SL1.pdf');
const outputPdf = path.join('test-pdfs', 'output-js.pdf');

console.log(`Testing PDF processor with:
Input: ${testPdf}
Output: ${outputPdf}
`);

// Set command line args and run the main function
process.argv = ['node', 'script.js', testPdf, outputPdf, '--dpi', '300'];
main(); 