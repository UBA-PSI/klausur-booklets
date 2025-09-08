const fs = require('fs');
const path = require('path');
const { PDFDocument, PageSizes } = require('pdf-lib');
const { PDFiumLibrary } = require('@hyzyla/pdfium');
const sharp = require('sharp');

// External PDF renderer using Ghostscript binaries (experimental feature)
const externalPdfRenderer = require('./pdf-renderer-external');

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
 * Get user configuration for PDF renderer
 * @returns {Object} User config with pdfRenderer and ghostscriptPathType settings
 */
function getUserConfig() {
  try {
    const fs = require('fs');
    const path = require('path');
    const { app } = require('electron');
    
    let configDir;
    if (process.platform === 'darwin') {
      configDir = app.getPath('userData');
    } else {
      // For Windows/Linux, try portable config first
      const appDir = path.dirname(process.execPath);
      const potentialPortableConfigDir = path.join(appDir, 'config');
      
      if (fs.existsSync(potentialPortableConfigDir)) {
        try {
          fs.accessSync(potentialPortableConfigDir, fs.constants.R_OK);
          configDir = potentialPortableConfigDir;
        } catch {
          configDir = app.getPath('userData');
        }
      } else {
        configDir = app.getPath('userData');
      }
    }
    
    const configPath = path.join(configDir, 'config.json');
    
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return {
        pdfRenderer: config.pdfRenderer || 'ghostscript', // Default to Ghostscript
        ghostscriptPathType: config.ghostscriptPathType || 'bundled',
        ghostscriptPath: config.ghostscriptPath || ''
      };
    }
  } catch (error) {
    console.warn(`[PDF Processor] Error reading config: ${error.message}`);
  }
  
  // Default configuration (Ghostscript as default)
  return {
    pdfRenderer: 'ghostscript',
    ghostscriptPathType: 'bundled',
    ghostscriptPath: ''
  };
}

/**
 * Get information about the current PDF renderer being used
 * @returns {Promise<{renderer: string, path: string, version?: string}>} Renderer information
 */
async function getRendererInfo() {
  const userConfig = getUserConfig();
  
  if (userConfig.pdfRenderer === 'ghostscript') {
    try {
      if (await externalPdfRenderer.isExternalRendererAvailable()) {
        const info = await externalPdfRenderer.getRendererInfo();
        const path = externalPdfRenderer.getCurrentGhostscriptPath();
        return {
          renderer: 'Ghostscript',
          path: path,
          version: info.replace(/^Ghostscript v/, '').replace(/ - .*$/, '')
        };
      }
    } catch (error) {
      // Fall through to WASM info
    }
  }
  
  return {
    renderer: 'PDFium WASM',
    path: 'embedded WebAssembly',
    version: 'built-in'
  };
}

/**
 * Renders the first page of a PDF to a PNG image buffer using PDFium and Sharp
 * @param {string} pdfPath - Path to the input PDF file
 * @param {number} dpi - DPI for rendering (default: 300)
 * @param {Function} statusCallback - Optional callback to receive status updates
 * @returns {Promise<Buffer>} - Promise resolving to PNG image buffer
 */
async function renderFirstPageToImage(pdfPath, dpi = 300, statusCallback = null) {
  // Get user config to determine renderer choice
  const userConfig = getUserConfig();
  
  // Get renderer info for status reporting
  const rendererInfo = await getRendererInfo();
  
  // Report renderer info to status callback
  if (statusCallback) {
    statusCallback(`Using ${rendererInfo.renderer} (v${rendererInfo.version}) from: ${rendererInfo.path}`);
  }
  
  // Use external PDF renderer (Ghostscript) if configured
  if (userConfig.pdfRenderer === 'ghostscript') {
    console.log(`[PDF Processor] Using external PDF renderer (Ghostscript) from: ${rendererInfo.path}`);
    try {
      if (await externalPdfRenderer.isExternalRendererAvailable()) {
        const result = await externalPdfRenderer.renderFirstPageToImage(pdfPath, dpi);
        console.log('[PDF Processor] External Ghostscript rendering successful');
        if (statusCallback) {
          statusCallback(`Ghostscript rendering completed successfully`);
        }
        return result;
      } else {
        console.log('[PDF Processor] Ghostscript external renderer not available, falling back to WASM');
        if (statusCallback) {
          statusCallback('Ghostscript not available, using PDFium WASM fallback');
        }
      }
    } catch (error) {
      console.error('[PDF Processor] External Ghostscript renderer failed:', error.message);
      console.log('[PDF Processor] Falling back to WASM PDFium');
      if (statusCallback) {
        statusCallback(`Ghostscript failed (${error.message}), using PDFium WASM fallback`);
      }
    }
  }

  // Use WASM PDFium renderer (either by choice or as fallback)
  console.log('[PDF Processor] Using WASM PDFium renderer');
  if (statusCallback) {
    statusCallback('Using PDFium WASM renderer (embedded WebAssembly)');
  }
  
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
    
    // Debug PDFium render dimensions
    console.log(`[PDF Processor] PDFium render dimensions: ${renderResult.width}x${renderResult.height} pixels`);
    console.log(`[PDF Processor] PDFium total pixels: ${(renderResult.width * renderResult.height).toLocaleString()}`);
    console.log(`[PDF Processor] PDFium DPI check - Width: ${renderResult.width} pixels = ${(renderResult.width/dpi).toFixed(2)} inches`);
    console.log(`[PDF Processor] PDFium DPI check - Height: ${renderResult.height} pixels = ${(renderResult.height/dpi).toFixed(2)} inches`);

    // Convert the raw BGRA bitmap data to a PNG buffer using Sharp
    // Assuming the output from renderResult.data is BGRA
    const pngBuffer = await sharp(renderResult.data, {
      raw: {
        width: renderResult.width,
        height: renderResult.height,
        channels: 4 // BGRA or RGBA
      },
      limitInputPixels: 268402689 * 4 // 4x default limit for large PDF renders
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
  getRendererInfo,
};