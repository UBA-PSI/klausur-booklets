const fs = require('fs');
const path = require('path');
const { PDFDocument, PageSizes } = require('pdf-lib');
const { PDFiumLibrary } = require('@hyzyla/pdfium');
const sharp = require('sharp');

// External PDF renderer using Ghostscript (system-installed)
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
        pdfRenderer: config.pdfRenderer || 'pdfium', // Default to PDFium WASM (built-in)
        ghostscriptPathType: config.ghostscriptPathType || 'system',
        ghostscriptPath: config.ghostscriptPath || ''
      };
    }
  } catch (error) {
    console.warn(`[PDF Processor] Error reading config: ${error.message}`);
  }
  
  // Default configuration (PDFium WASM as default, GS requires separate installation)
  return {
    pdfRenderer: 'pdfium',
    ghostscriptPathType: 'system',
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
          version: info.replace(/^Ghostscript\s*v?/, '').replace(/ - .*$/, '')
        };
      }
    } catch (error) {
      // Fall through to WASM info
    }
  }
  
  const wasmPath = userConfig.pdfRenderer === 'ghostscript'
    ? 'embedded WebAssembly (fallback - Ghostscript configured but not found)'
    : 'embedded WebAssembly';

  return {
    renderer: 'PDFium WASM',
    path: wasmPath,
    version: 'built-in'
  };
}

/**
 * Analyze a PDF file to identify potential rendering issues
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<Object>} Analysis results with warnings and recommendations
 */
async function analyzePdfFile(pdfPath) {
  const analysis = {
    file: path.basename(pdfPath),
    filePath: pdfPath,
    fileSize: 0,
    fileSizeMB: 0,
    pageCount: 0,
    firstPageDimensions: null,
    potentialIssues: [],
    recommendations: [],
    riskLevel: 'low' // low, medium, high
  };

  try {
    // Basic file information
    const stats = fs.statSync(pdfPath);
    analysis.fileSize = stats.size;
    analysis.fileSizeMB = parseFloat((stats.size / (1024 * 1024)).toFixed(2));

    // Large file warning
    if (analysis.fileSizeMB > 50) {
      analysis.potentialIssues.push(`Large file size (${analysis.fileSizeMB} MB) may cause memory issues`);
      analysis.riskLevel = 'medium';
    }
    if (analysis.fileSizeMB > 200) {
      analysis.riskLevel = 'high';
      analysis.recommendations.push('Consider using Ghostscript renderer for large files');
    }

    // Try to analyze with PDFium
    await initializePdfium();
    if (pdfiumLibrary) {
      const pdfBuffer = fs.readFileSync(pdfPath);
      let pdfDocument = null;

      try {
        pdfDocument = await pdfiumLibrary.loadDocument(pdfBuffer);
        
        // Enhanced page count detection with fallbacks
        let pageCount = pdfDocument.pageCount;
        if (pageCount === undefined || pageCount === null || isNaN(pageCount)) {
          console.log(`[PDF Analysis] PDFium pageCount is ${pageCount}, attempting manual detection...`);
          
          // Try alternative methods to get page count
          try {
            // Method 1: Try to access page 0 to see if document is valid
            const testPage = await pdfDocument.getPage(0);
            if (testPage) {
              // Document has at least 1 page, try to find more
              pageCount = 1;
              
              // Try to detect more pages (up to 10 for analysis - most problematic PDFs are single page)
              for (let i = 1; i < 10; i++) {
                try {
                  await pdfDocument.getPage(i);
                  pageCount = i + 1;
                } catch {
                  break; // No more pages
                }
              }
              console.log(`[PDF Analysis] Manual page detection found ${pageCount} pages`);
            }
          } catch (pageError) {
            console.log(`[PDF Analysis] Failed to access any pages: ${pageError.message}`);
            pageCount = 0;
            analysis.potentialIssues.push('PDFium cannot access PDF pages - likely structural incompatibility');
            analysis.riskLevel = 'high';
          }
        }
        
        analysis.pageCount = pageCount;

        if (analysis.pageCount === 0) {
          analysis.potentialIssues.push('PDF has no pages or PDFium cannot access them');
          analysis.riskLevel = 'high';
        } else if (analysis.pageCount > 1000) {
          analysis.potentialIssues.push(`Very large page count (${analysis.pageCount})`);
          analysis.riskLevel = 'medium';
        }

        // Analyze first page
        if (analysis.pageCount > 0) {
          try {
            const page = await pdfDocument.getPage(0);
            
            // Enhanced page dimension detection with fallbacks
            let pageWidth = page.width;
            let pageHeight = page.height;
            
            // If dimensions are undefined/null, try alternative detection
            if (!pageWidth || !pageHeight || isNaN(pageWidth) || isNaN(pageHeight)) {
              console.log(`[PDF Analysis] Page dimensions unavailable from PDFium (${pageWidth}x${pageHeight}), this indicates structural incompatibility`);
              analysis.potentialIssues.push('PDFium cannot read page dimensions - structural incompatibility likely');
              analysis.riskLevel = 'high';
              
              // Set default values for analysis
              pageWidth = pageWidth || 612; // Default to letter size
              pageHeight = pageHeight || 792;
            }
            
            analysis.firstPageDimensions = {
              width: pageWidth,
              height: pageHeight,
              widthInches: parseFloat((pageWidth / 72).toFixed(2)),
              heightInches: parseFloat((pageHeight / 72).toFixed(2))
            };

            // Check for extremely large dimensions
            const maxDimension = Math.max(pageWidth, pageHeight);
            if (maxDimension > 14400) { // > 200 inches at 72 DPI
              analysis.potentialIssues.push(`Extremely large page dimensions (${analysis.firstPageDimensions.widthInches}" x ${analysis.firstPageDimensions.heightInches}")`);
              analysis.riskLevel = 'high';
              analysis.recommendations.push('Large page dimensions may cause PDFium WASM to fail');
            } else if (maxDimension > 7200) { // > 100 inches at 72 DPI
              analysis.potentialIssues.push(`Very large page dimensions (${analysis.firstPageDimensions.widthInches}" x ${analysis.firstPageDimensions.heightInches}")`);
              analysis.riskLevel = Math.max(analysis.riskLevel, 'medium') === 'medium' ? 'medium' : 'high';
            }

            // Calculate memory requirements at different DPIs
            const memoryAt300DPI = Math.round((pageWidth * (300/72)) * (pageHeight * (300/72)) * 4 / (1024*1024));
            if (memoryAt300DPI > 500) { // > 500MB
              analysis.potentialIssues.push(`High memory requirement (~${memoryAt300DPI} MB at 300 DPI)`);
              analysis.riskLevel = 'high';
              analysis.recommendations.push('Consider using Ghostscript renderer or lower DPI');
            } else if (memoryAt300DPI > 100) { // > 100MB
              analysis.potentialIssues.push(`Moderate memory requirement (~${memoryAt300DPI} MB at 300 DPI)`);
              analysis.riskLevel = Math.max(analysis.riskLevel, 'medium') === 'medium' ? 'medium' : 'high';
            }
          } catch (pageError) {
            analysis.potentialIssues.push(`Failed to analyze first page: ${pageError.message}`);
            analysis.riskLevel = 'high';
          }
        }

      } catch (docError) {
        analysis.potentialIssues.push(`Failed to load PDF document: ${docError.message}`);
        analysis.riskLevel = 'high';
        analysis.recommendations.push('PDF may be corrupted or use unsupported features');
      } finally {
        if (pdfDocument) {
          pdfDocument.destroy();
        }
      }
    } else {
      analysis.potentialIssues.push('PDFium library not available for analysis');
      analysis.riskLevel = 'medium';
    }

    // General recommendations based on risk level
    if (analysis.riskLevel === 'high') {
      analysis.recommendations.push('Strongly recommend switching to Ghostscript renderer');
      analysis.recommendations.push('Test with a lower DPI setting (150-200 instead of 300)');
    } else if (analysis.riskLevel === 'medium') {
      analysis.recommendations.push('Consider using Ghostscript renderer if PDFium fails');
    }

    if (analysis.recommendations.length === 0) {
      analysis.recommendations.push('PDF appears compatible with PDFium WASM renderer');
    }

  } catch (error) {
    analysis.potentialIssues.push(`Analysis failed: ${error.message}`);
    analysis.riskLevel = 'high';
  }

  return analysis;
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
  let ghostscriptFallbackReason = null; // 'not-found' or 'render-failed'
  let ghostscriptErrorDetail = '';

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
        ghostscriptFallbackReason = 'not-found';
        console.log('[PDF Processor] WARNING: Ghostscript configured but not available, falling back to WASM');
        if (statusCallback) {
          statusCallback('WARNING: Ghostscript is configured but was NOT FOUND. Using PDFium WASM fallback. Check Settings > PDF Processing.');
        }
      }
    } catch (error) {
      ghostscriptFallbackReason = 'render-failed';
      ghostscriptErrorDetail = error.message;
      console.error('[PDF Processor] WARNING: Ghostscript renderer failed:', error.message);
      console.log('[PDF Processor] Falling back to WASM PDFium');
      if (statusCallback) {
        statusCallback(`WARNING: Ghostscript failed (${error.message}). Using PDFium WASM fallback.`);
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

  // Load the PDF document data (once)
  const pdfBuffer = fs.readFileSync(pdfPath);

  // Pre-analyze PDF for known problematic features
  let hasKnownIssues = false;
  try {
    const pdfContent = pdfBuffer.toString('latin1');
    
    const problematicFeatures = [];
    if (/\/SMask/.test(pdfContent)) problematicFeatures.push('Soft masks (transparency)');
    if (/\/BM\s*\//.test(pdfContent)) problematicFeatures.push('Blend modes');
    if (/\/CA\s+/.test(pdfContent)) problematicFeatures.push('Constant alpha');
    if (/\/Shading/.test(pdfContent)) problematicFeatures.push('Complex shading');
    if (/\/Pattern/.test(pdfContent)) problematicFeatures.push('Pattern fills');
    
    const fontMatches = pdfContent.match(/\/BaseFont\s*\/([^\s\/\]>]+)/g);
    const fontCount = fontMatches ? [...new Set(fontMatches)].length : 0;
    
    if (problematicFeatures.length > 0) {
      hasKnownIssues = true;
      console.log(`[PDF Processor] ⚠️ PDF contains advanced features: ${problematicFeatures.join(', ')}`);
      if (statusCallback) {
        statusCallback(`PDF contains advanced features - may require Ghostscript renderer`);
      }
    }
    
    if (fontCount > 50) {
      console.log(`[PDF Processor] Complex PDF with ${fontCount} fonts detected`);
    }
    
  } catch (preAnalysisError) {
    console.log(`[PDF Processor] Pre-analysis failed: ${preAnalysisError.message}`);
  }

  let pdfDocument = null;
  try {

    // Load document using PDFium
    pdfDocument = await pdfiumLibrary.loadDocument(pdfBuffer);

    if (pdfDocument.pageCount < 1) {
      throw new Error('PDF has no pages.');
    }

    // Get the first page
    const pageIndex = 0;
    const page = await pdfDocument.getPage(pageIndex);

    // Get page dimensions in points (72 points = 1 inch)
    const pageWidth = page.width;
    const pageHeight = page.height;
    const pageWidthInches = pageWidth / 72;
    const pageHeightInches = pageHeight / 72;
    
    // Calculate scale to fit A4 dimensions at target DPI, handling oversized PDFs
    // A4 = 8.27" x 11.69"
    const targetWidthInches = 8.27;
    const targetHeightInches = 11.69;
    
    // Calculate scale factors to fit within A4
    const scaleToFitWidth = targetWidthInches / pageWidthInches;
    const scaleToFitHeight = targetHeightInches / pageHeightInches;
    
    // Use the smaller scale factor to ensure the page fits within A4
    const scaleToFit = Math.min(scaleToFitWidth, scaleToFitHeight, 1.0); // Never scale up beyond original
    
    // Final scale combines A4 fitting with DPI requirements
    const dpiScale = dpi / 72;
    const finalScale = scaleToFit * dpiScale;
    
    let finalWidthPixels = Math.round(pageWidth * finalScale);
    let finalHeightPixels = Math.round(pageHeight * finalScale);
    
    // Log essential PDF information for users
    if (scaleToFit < 1.0) {
      console.log(`[PDF Processor] Large PDF (${pageWidthInches.toFixed(1)}" x ${pageHeightInches.toFixed(1)}") - scaling to fit`);
    }
    
    if (statusCallback) {
      statusCallback(`Processing: ${path.basename(pdfPath)}`);
    }

    // Try multiple rendering strategies with enhanced error reporting
    let renderResult = null;
    const renderStrategies = [
      { scale: finalScale, render: 'bitmap', description: 'Primary strategy (bitmap with calculated scale)' },
      { scale: Math.min(finalScale, 4.0), render: 'bitmap', description: 'Fallback 1 (reduced scale, max 4x)' },
      { scale: Math.min(finalScale, 2.0), render: 'bitmap', description: 'Fallback 2 (reduced scale, max 2x)' },
      { scale: 1.0, render: 'bitmap', description: 'Fallback 3 (1x scale)' },
      { scale: 0.5, render: 'bitmap', description: 'Fallback 4 (0.5x scale)' },
      // Additional strategies for problematic PDFs
      { scale: 0.25, render: 'bitmap', description: 'Fallback 5 (very low scale, transparency workaround)' },
      { scale: 0.1, render: 'bitmap', description: 'Fallback 6 (minimal scale, last resort)' }
    ];

    for (let i = 0; i < renderStrategies.length; i++) {
      const strategy = renderStrategies[i];
      try {
        // Only log the first attempt and failures to reduce verbosity
        if (i === 0) {
          console.log(`[PDF Processor] Rendering PDF...`);
          if (statusCallback) {
            statusCallback(`Rendering PDF page...`);
          }
        }
        
        // Try different render options for problematic PDFs
        let renderOptions = { 
          scale: strategy.scale, 
          render: strategy.render 
        };
        
        renderResult = await page.render(renderOptions);

        // Validate rendering result
        if (!renderResult || !renderResult.data || !renderResult.width || !renderResult.height || renderResult.data.length === 0) {
          throw new Error(`Invalid render result`);
        }

        // Success - log only if it wasn't the first strategy (indicating fallback was needed)
        if (i > 0) {
          console.log(`[PDF Processor] PDF rendered successfully using fallback method`);
        }
        
        // Update final dimensions for Sharp processing
        finalWidthPixels = renderResult.width;
        finalHeightPixels = renderResult.height;
        
        break; // Success, exit the retry loop

      } catch (strategyError) {
        // Only log if this is getting concerning (after a few attempts)
        if (i >= 2) {
          console.log(`[PDF Processor] Render attempt ${i + 1} failed, trying alternative approach...`);
        }
        
        if (i === renderStrategies.length - 1) {
          // This was the last strategy, throw a user-friendly error
          let errorMessage = `Unable to render PDF after ${renderStrategies.length} attempts.`;

          if (ghostscriptFallbackReason === 'not-found') {
            errorMessage += `\n\nGhostscript is configured but was not found on this system. Please install Ghostscript or verify the path in Settings > PDF Processing.`;
          } else if (ghostscriptFallbackReason === 'render-failed') {
            errorMessage += `\n\nGhostscript was found but failed to render this PDF: ${ghostscriptErrorDetail}\n\nThe PDFium WASM fallback also failed. Check your Ghostscript installation (resource files may be missing).`;
          } else if (hasKnownIssues) {
            errorMessage += `\n\nThis PDF contains advanced features (transparency, blend modes) that are not compatible with the built-in PDF renderer.\n\nSolution: Switch to Ghostscript renderer in Settings > PDF Processing.`;
          } else {
            errorMessage += `\n\nThis PDF may not be compatible with the built-in PDF renderer.\n\nTry: Switch to Ghostscript renderer in Settings > PDF Processing.`;
          }

          throw new Error(errorMessage);
        }
      }
    }

    if (!renderResult) {
      throw new Error('All rendering strategies failed - renderResult is still null');
    }
    
    // Log scaling success for oversized PDFs (user feedback)
    if (scaleToFit < 1.0) {
        console.log(`[PDF Processor] PDFium scaled to: ${renderResult.width}x${renderResult.height} pixels`);
    }

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
 * Converts an image to a PDF with A5 page size.
 * @param {Buffer} imageBuffer - PNG image buffer
 * @param {string} outputPath - Path to save the output PDF
 * @param {Object} [options] - Optional configuration
 * @param {number} [options.scaleFactor=1.0] - Scale factor for margin enforcement (0-1.0)
 * @returns {Promise<void>}
 */
async function imageToPdf(imageBuffer, outputPath, options = {}) {
  const scaleFactor = options.scaleFactor || 1.0;
  const pdfDoc = await PDFDocument.create();
  const [width, height] = PageSizes.A5;
  const page = pdfDoc.addPage([width, height]);
  const image = await pdfDoc.embedPng(imageBuffer);

  // Scale to fit A5 while preserving aspect ratio, then apply margin scale factor
  const imgDims = image.size();
  const scale = Math.min(width / imgDims.width, height / imgDims.height) * scaleFactor;
  const imgWidth = imgDims.width * scale;
  const imgHeight = imgDims.height * scale;

  page.drawImage(image, {
    x: (width - imgWidth) / 2,
    y: (height - imgHeight) / 2,
    width: imgWidth,
    height: imgHeight,
  });

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, pdfBytes);
}

module.exports = {
  renderFirstPageToImage,
  imageToPdf,
  getRendererInfo,
  analyzePdfFile,
};