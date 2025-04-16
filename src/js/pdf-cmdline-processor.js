const fs = require('fs');
const path = require('path');
const { PDFDocument, PageSizes } = require('pdf-lib');
const { getDocument } = require('pdfjs-dist');
const { createCanvas } = require('canvas');
const yargs = require('yargs');

// Configure PDF.js
const pdfjsLib = require('pdfjs-dist');
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/build/pdf.worker.js');

/**
 * Renders the first page of a PDF to an image
 * @param {string} pdfPath - Path to the input PDF file
 * @param {number} dpi - DPI for rendering (default: 300)
 * @returns {Promise<Buffer>} - Promise resolving to image buffer
 */
async function renderFirstPageToImage(pdfPath, dpi = 300) {
  // Load the PDF document
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdfDocument = await getDocument({ data }).promise;
  
  // Get the first page
  const page = await pdfDocument.getPage(1);
  
  // Calculate scale based on DPI (PDF uses 72 DPI internally)
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });
  
  // Create a canvas with the right dimensions
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext('2d');
  
  // Render the PDF page to the canvas
  const renderContext = {
    canvasContext: context,
    viewport: viewport
  };
  
  await page.render(renderContext).promise;
  
  // Return the image as a buffer
  return canvas.toBuffer('image/png');
}

/**
 * Converts an image to a PDF with A5 page size
 * @param {Buffer} imageBuffer - Image buffer
 * @param {string} outputPath - Path to save the output PDF
 * @returns {Promise<void>}
 */
async function imageToPdf(imageBuffer, outputPath) {
  // Create a new PDF document
  const pdfDoc = await PDFDocument.create();
  
  // Define page size (A5)
  const [width, height] = PageSizes.A5;
  
  // Add a blank page
  const page = pdfDoc.addPage([width, height]);
  
  // Embed the image
  const image = await pdfDoc.embedPng(imageBuffer);
  
  // Calculate scaling to fit within A5
  const imgDims = image.size();
  const xScale = width / imgDims.width;
  const yScale = height / imgDims.height;
  const scale = Math.min(xScale, yScale);
  
  const imgWidth = imgDims.width * scale;
  const imgHeight = imgDims.height * scale;
  
  // Position image centered on page
  const x = 0;
  const y = (height - imgHeight) / 2;
  
  // Draw the image
  page.drawImage(image, {
    x,
    y,
    width: imgWidth,
    height: imgHeight,
  });
  
  // Save the PDF
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, pdfBytes);
}

/**
 * Main function
 */
async function main() {
  // Parse command line arguments
  const argv = yargs
    .option('dpi', {
      describe: 'DPI value for rendering the PDF to an image',
      type: 'number',
      default: 300
    })
    .demandCommand(2)
    .usage('Usage: $0 <input_pdf> <output_pdf> [options]')
    .help()
    .argv;
  
  const inputPdf = argv._[0];
  const outputPdf = argv._[1];
  const dpi = argv.dpi;
  
  try {
    console.log(`Processing ${inputPdf} with DPI ${dpi}...`);
    
    // Render first page to image
    const imageBuffer = await renderFirstPageToImage(inputPdf, dpi);
    
    // Convert image to PDF
    await imageToPdf(imageBuffer, outputPdf);
    
    console.log(`Successfully created ${outputPdf}`);
  } catch (error) {
    console.error('Error processing PDF:', error);
    process.exit(1);
  }
}

// Run the script if it's called directly
if (require.main === module) {
  main();
}

module.exports = {
  renderFirstPageToImage,
  imageToPdf,
  main
};