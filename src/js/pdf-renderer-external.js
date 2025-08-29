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
 * Get the path to the Ghostscript executable for the current platform
 * @returns {string} Path to gs executable
 */
function getGhostscriptPath() {
    // More reliable detection of development vs production
    // Check if we're running from the project directory (npm start) vs packaged app
    const isDev = process.env.NODE_ENV === 'development' || 
                  process.cwd().includes('psi-pdf-merger-tool') ||
                  __dirname.includes('src/js');
    
    let binDir;
    if (isDev) {
        // In development, look in project root/bin
        binDir = path.join(__dirname, '../../bin');
        console.log(`[External PDF Renderer] Development mode - looking in: ${binDir}`);
    } else {
        // In production, look in unpacked resources
        binDir = path.join(process.resourcesPath, 'bin');
        console.log(`[External PDF Renderer] Production mode - looking in: ${binDir}`);
    }
    
    let executableName;
    switch (process.platform) {
        case 'win32':
            // Windows: Bundle gs executable
            executableName = 'gs.exe';
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
    console.log(`[External PDF Renderer] Resolved Ghostscript path: ${fullPath}`);
    
    // Check if file exists, if not try development path as fallback
    if (!fs.existsSync(fullPath) && !isDev) {
        console.log(`[External PDF Renderer] Binary not found in production path, trying development fallback...`);
        const devBinDir = path.join(__dirname, '../../bin');
        const devPath = path.join(devBinDir, executableName);
        console.log(`[External PDF Renderer] Trying fallback path: ${devPath}`);
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
        console.log(`[External PDF Renderer] Ghostscript available: ${stdout.trim()}`);
        return true;
    } catch (error) {
        console.error('[External PDF Renderer] Ghostscript not available:', error.message);
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
    console.log(`[External PDF Renderer] Starting Ghostscript render: ${path.basename(pdfPath)} at ${dpi} DPI`);
    
    try {
        const gsPath = getGhostscriptPath();
        
        // Create temporary output file
        const tempOutputPath = path.join(os.tmpdir(), `gs_render_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`);
        
        // Execute Ghostscript: gs -sDEVICE=png16m -r300 -dFirstPage=1 -dLastPage=1 -o output.png input.pdf
        const args = [
            '-sDEVICE=png16m',          // PNG device with 16M colors
            `-r${dpi}`,                 // Resolution (DPI)
            '-dFirstPage=1',            // Start at first page
            '-dLastPage=1',             // End at first page
            '-dSAFER',                  // Security flag
            '-dBATCH',                  // Batch mode (no user interaction)
            '-dNOPAUSE',                // Don't pause between pages
            '-dQUIET',                  // Reduce console output
            `-sOutputFile=${tempOutputPath}`,  // Output file
            pdfPath                     // Input PDF
        ];
        
        console.log(`[External PDF Renderer] Executing: ${gsPath} ${args.join(' ')}`);
        
        const { stdout, stderr } = await execFileAsync(gsPath, args, { 
            timeout: 30000,  // 30 second timeout
            maxBuffer: 10 * 1024 * 1024  // 10MB buffer
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
        console.log(`[External PDF Renderer] PNG rendered successfully (${pngBuffer.length} bytes)`);
        
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

module.exports = {
    isExternalRendererAvailable,
    renderFirstPageToImage,
    getRendererInfo
};