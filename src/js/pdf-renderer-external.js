const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const os = require('os');

/**
 * External PDF renderer using Ghostscript binaries
 * This replaces the WASM-based PDFium implementation to resolve
 * out-of-bounds read issues on Windows with large PDF files.
 * 
 * Approach:
 * - Bundle gs binaries for macOS/Windows
 * - Require gs installation on Linux (via package manager)
 * - Direct command-line execution: gs -sDEVICE=png16m -r300 -o output.png input.pdf
 * 
 * Advantages:
 * - No Node.js library dependencies
 * - Proven, stable PDF rendering
 * - Simple command-line interface
 * - Excellent cross-platform support
 */

/**
 * Get user configuration for Ghostscript from config file
 * @returns {Object} Config with ghostscriptPathType and ghostscriptPath
 */
function getUserGhostscriptConfig() {
    try {
        // Determine config path using same logic as main.js
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
                ghostscriptPathType: config.ghostscriptPathType || 'bundled',
                ghostscriptPath: config.ghostscriptPath || ''
            };
        }
    } catch (error) {
        console.warn(`[External PDF Renderer] Error reading config for Ghostscript path: ${error.message}`);
    }
    
    // Default to bundled (except Linux which uses system)
    return {
        ghostscriptPathType: process.platform === 'linux' ? 'system' : 'bundled',
        ghostscriptPath: ''
    };
}

/**
 * Get the path to the Ghostscript executable for the current platform
 * @returns {string} Path to gs executable
 */
function getGhostscriptPath() {
    // Get user Ghostscript configuration
    const gsConfig = getUserGhostscriptConfig();
    
    // If user selected custom path and provided one, use it
    if (gsConfig.ghostscriptPathType === 'custom' && gsConfig.ghostscriptPath && gsConfig.ghostscriptPath.trim()) {
        const customPath = gsConfig.ghostscriptPath.trim();
        return customPath;
    }
    
    // If on Linux and using system GS, return 'gs' for PATH lookup
    if (process.platform === 'linux' && gsConfig.ghostscriptPathType === 'system') {
        return 'gs';
    }
    
    // More reliable detection of development vs production
    // Check if we're running from the project directory (npm start) vs packaged app
    const isDev = process.env.NODE_ENV === 'development' || 
                  process.cwd().includes('psi-pdf-merger-tool') ||
                  __dirname.includes('src/js');
    
    let binDir;
    if (isDev) {
        // In development, look in project root/bin
        binDir = path.join(__dirname, '../../bin');
    } else {
        // In production, look in unpacked resources
        binDir = path.join(process.resourcesPath, 'bin');
    }
    
    let executableName;
    switch (process.platform) {
        case 'win32':
            // Windows: Bundle gswin64c.exe (64-bit console version)
            executableName = 'gswin64c.exe';
            break;
        case 'darwin':
            // macOS: Bundle gs executable (universal or architecture-specific)
            if (process.arch === 'arm64') {
                executableName = 'gs-macos-arm64';
            } else if (process.arch === 'x64') {
                executableName = 'gs-macos-x64';
            } else {
                throw new Error(`Unsupported macOS architecture: ${process.arch}`);
            }
            break;
        case 'linux':
            // Linux: Expect gs to be in PATH (user installs via package manager)
            return 'gs';
        default:
            throw new Error(`Unsupported platform: ${process.platform}`);
    }
    
    const fullPath = path.join(binDir, executableName);
    
    // Check if file exists, if not try development path as fallback
    if (!fs.existsSync(fullPath) && !isDev) {
        const devBinDir = path.join(__dirname, '../../bin');
        const devPath = path.join(devBinDir, executableName);
        if (fs.existsSync(devPath)) {
            return devPath;
        }
    }
    
    return fullPath;
}

/**
 * Check if Ghostscript external renderer is available
 * @returns {Promise<boolean>} True if renderer is available
 */
async function isExternalRendererAvailable() {
    try {
        const gsPath = getGhostscriptPath();
        
        // Test gs with version command
        const { stdout } = await execFileAsync(gsPath, ['--version'], { timeout: 5000 });
        // Only log on first successful detection to reduce verbosity
        return true;
    } catch (error) {
        console.log('[External PDF Renderer] Ghostscript not available, using PDFium fallback');
        return false;
    }
}

/**
 * Render the first page of a PDF to a PNG image buffer using Ghostscript
 * @param {string} pdfPath - Path to the input PDF file
 * @param {number} dpi - DPI for rendering (default: 300)
 * @returns {Promise<Buffer>} Promise resolving to PNG image buffer
 */
async function renderFirstPageToImage(pdfPath, dpi = 300) {
    try {
        const gsPath = getGhostscriptPath();
        
        // Create temporary output file
        const tempOutputPath = path.join(os.tmpdir(), `gs_render_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`);
        
        // Calculate target dimensions for A4 at specified DPI
        // A4 = 8.27" x 11.69" = 210mm x 297mm
        const targetWidthInches = 8.27;
        const targetHeightInches = 11.69;
        const targetWidthPixels = Math.round(targetWidthInches * dpi);
        const targetHeightPixels = Math.round(targetHeightInches * dpi);
        
        // Execute Ghostscript with fixed output size to handle oversized PDFs
        const args = [
            '-sDEVICE=png16m',          // PNG device with 16M colors
            `-r${dpi}`,                 // Resolution (DPI)
            '-dFirstPage=1',            // Start at first page
            '-dLastPage=1',             // End at first page
            '-dSAFER',                  // Security flag
            '-dBATCH',                  // Batch mode (no user interaction)
            '-dNOPAUSE',                // Don't pause between pages
            '-dQUIET',                  // Reduce console output
            '-dFIXEDMEDIA',             // Use fixed media size instead of PDF page size
            '-dPDFFitPage',             // Scale PDF to fit the media size
            `-dDEVICEWIDTHPOINTS=${targetWidthPixels * 72 / dpi}`,   // Target width in points (72 points = 1 inch)
            `-dDEVICEHEIGHTPOINTS=${targetHeightPixels * 72 / dpi}`, // Target height in points
            `-sOutputFile=${tempOutputPath}`,  // Output file
            pdfPath                     // Input PDF
        ];
        
        const { stdout, stderr } = await execFileAsync(gsPath, args, { 
            timeout: 60000,  // 60 second timeout for large images
            maxBuffer: 50 * 1024 * 1024  // 50MB buffer for large images
        });
        
        if (stderr && stderr.trim()) {
            console.log(`[External PDF Renderer] Ghostscript stderr: ${stderr.trim()}`);
        }
        
        // Check if output file was created
        if (!fs.existsSync(tempOutputPath)) {
            throw new Error('Ghostscript did not create output file');
        }
        
        // Read the generated PNG file
        const pngBuffer = fs.readFileSync(tempOutputPath);
        
        // Check if scaling was applied (for user feedback on oversized PDFs)
        try {
            const sharp = require('sharp');
            const imageMetadata = await sharp(pngBuffer).metadata();
            
            // Only log scaling info if dimensions don't match original PDF size
            const expectedPixels = targetWidthPixels * targetHeightPixels;
            const actualPixels = imageMetadata.width * imageMetadata.height;
            const wasScaled = Math.abs(actualPixels - expectedPixels) / expectedPixels < 0.1;
            
            if (wasScaled && (imageMetadata.width !== targetWidthPixels || imageMetadata.height !== targetHeightPixels)) {
                console.log(`[External PDF Renderer] PDF scaled to A4 size: ${imageMetadata.width}x${imageMetadata.height} pixels (${(pngBuffer.length / (1024*1024)).toFixed(1)} MB)`);
            }
        } catch (metadataError) {
            // Ignore metadata errors - not critical
        }
        
        // Clean up temporary file
        try {
            fs.unlinkSync(tempOutputPath);
        } catch (cleanupError) {
            console.warn(`[External PDF Renderer] Failed to cleanup temp file: ${cleanupError.message}`);
        }
        
        return pngBuffer;
        
    } catch (error) {
        console.error(`[External PDF Renderer] Error rendering PDF: ${error.message}`);
        console.error(`[External PDF Renderer] Stack trace:`, error.stack);
        throw new Error(`Ghostscript rendering failed: ${error.message}`);
    }
}

/**
 * Test the external renderer with version info
 * @returns {Promise<string>} Version and capability information
 */
async function getRendererInfo() {
    try {
        const gsPath = getGhostscriptPath();
        
        // Get Ghostscript version and info
        const { stdout } = await execFileAsync(gsPath, ['--version'], { timeout: 5000 });
        const version = stdout.trim();
        
        return `Ghostscript ${version} - PostScript and PDF processor`;
    } catch (error) {
        throw new Error(`Cannot get Ghostscript info: ${error.message}`);
    }
}

/**
 * Get the current Ghostscript path being used
 * @returns {string} Current Ghostscript executable path
 */
function getCurrentGhostscriptPath() {
    return getGhostscriptPath();
}

module.exports = {
    isExternalRendererAvailable,
    renderFirstPageToImage,
    getRendererInfo,
    getCurrentGhostscriptPath,
};