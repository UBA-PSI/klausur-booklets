const fs = require('fs');
const path = require('path');
const { PDFDocument, PageSizes } = require('pdf-lib');
const { PDFiumLibrary } = require('@hyzyla/pdfium');
const sharp = require('sharp');

// --- Initialize PDFium Library ---
let pdfiumLibrary = null;
let initializePdfiumPromise = null;

function initializePdfium() {
  if (!initializePdfiumPromise) {
    initializePdfiumPromise = (async () => {
      try {
        // Resolve the path to the wasm file relative to the @hyzyla/pdfium package
        const wasmFilePath = require.resolve('@hyzyla/pdfium/dist/pdfium.wasm');
        if (!fs.existsSync(wasmFilePath)) {
           throw new Error(`pdfium.wasm not found at resolved path: ${wasmFilePath}. Ensure @hyzyla/pdfium is installed correctly.`);
        }
        const wasmBinary = fs.readFileSync(wasmFilePath);
        console.log('Initializing PDFium WASM Library...');
        pdfiumLibrary = await PDFiumLibrary.init({ wasmBinary });
        console.log('PDFium WASM Library initialized successfully.');
      } catch (err) {
        console.error('CRITICAL: Failed to initialize PDFium Library:', err);
        // Make the promise reject so subsequent calls will fail
        throw err; 
      }
    })();
  }
  return initializePdfiumPromise;
}
// --- End Initialization ---

/**
 * Renders the first page of a PDF to a PNG image buffer using PDFium and Sharp
 * @param {string} pdfPath - Path to the input PDF file
 * @param {number} dpi - DPI for rendering (default: 300)
 * @returns {Promise<Buffer>} - Promise resolving to PNG image buffer
 */
async function renderFirstPageToImage(pdfPath, dpi = 300) {
  // Ensure PDFium is initialized
  await initializePdfium();
  if (!pdfiumLibrary) {
      throw new Error("PDFium library failed to initialize.");
  }

  let pdfDocument = null;
  try {
    // Load the PDF document data
    const pdfBuffer = fs.readFileSync(pdfPath);

    // Load document using PDFium
    pdfDocument = await pdfiumLibrary.loadDocument(pdfBuffer);

    if (pdfDocument.pageCount < 1) {
      throw new Error('PDF has no pages.');
    }

    // Get the first page
    const pageIndex = 0;
    const page = await pdfDocument.getPage(pageIndex);

    // Calculate scale based on DPI (PDF uses 72 DPI internally)
    const scale = dpi / 72;

    // Render the page to a raw bitmap (BGRA format based on hyzyla/pdfium docs)
    // Note: hyzyla/pdfium might render BGRA by default. Check its docs if colors are swapped.
    // If it renders RGBA, use { raw: { width, height, channels: 4 } } in sharp.
    const renderResult = await page.render({ scale, render: 'bitmap' });

    if (!renderResult || !renderResult.data || !renderResult.width || !renderResult.height) {
      throw new Error('Failed to get valid bitmap data from page.render().');
    }

    // Convert the raw BGRA bitmap data to a PNG buffer using Sharp
    // Assuming the output from renderResult.data is BGRA
    const pngBuffer = await sharp(renderResult.data, {
      raw: {
        width: renderResult.width,
        height: renderResult.height,
        channels: 4 // BGRA or RGBA
      }
    })
    .png() // Specify PNG output
    .toBuffer();

    return pngBuffer;

  } finally {
    // Ensure the document is destroyed to free WASM memory
    if (pdfDocument) {
      pdfDocument.destroy();
    }
    // We generally don't destroy the library itself here, keep it initialized.
  }
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
  
  // Calculate scaling to fit within A5 while preserving aspect ratio
  const imgDims = image.size();
  const xScale = width / imgDims.width;
  const yScale = height / imgDims.height;
  const scale = Math.min(xScale, yScale); // Use the smaller scale factor to fit
  
  const imgWidth = imgDims.width * scale;
  const imgHeight = imgDims.height * scale;
  
  // Position image: Center horizontally, align to top vertically
  const x = (width - imgWidth) / 2; 
  const y = height - imgHeight; // Align top edge of image with top edge of page (assuming y=0 is bottom)
  
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

module.exports = {
  renderFirstPageToImage,
  imageToPdf,
};