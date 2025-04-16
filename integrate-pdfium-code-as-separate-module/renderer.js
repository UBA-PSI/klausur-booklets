// Renderer using @hyzyla/pdfium to render the PDF page
const { ipcRenderer } = require('electron');
const { PDFiumLibrary } = require('@hyzyla/pdfium'); // Import from @hyzyla/pdfium
const fs = require('node:fs'); // Import fs to read the wasm file
const path = require('node:path'); // Import path to construct the wasm path

// Construct the path to the wasm file
// __dirname points to the root of the app where index.html/renderer.js are
const wasmFilePath = path.join(__dirname, 'node_modules/@hyzyla/pdfium/dist/pdfium.wasm');
console.log('Resolved path to pdfium.wasm:', wasmFilePath);

document.addEventListener('DOMContentLoaded', function() {
    // console.log('DOM loaded'); // Removed

    const pdfInput = document.getElementById('pdfInput');
    const rasterizeBtn = document.getElementById('rasterizeBtn');
    const statusDiv = document.getElementById('status');

    let selectedFileObject = null;
    rasterizeBtn.disabled = true;

    let pdfiumLibrary = null;
    
    // --- Initialize PDFium Library --- 
    // Read the Wasm file content first
    let wasmBinary = null;
    try {
        console.log(`Attempting to read wasm file from: ${wasmFilePath}`);
        wasmBinary = fs.readFileSync(wasmFilePath);
        // console.log(`Read ${wasmBinary.length} bytes from pdfium.wasm`); // Removed
    } catch (err) {
        console.error('CRITICAL: Failed to read pdfium.wasm file:', err);
        updateStatus(`Error: Failed to load PDF engine Wasm file. Path: ${wasmFilePath}.`, 'error');
        // Keep button disabled if we can't even read the wasm file
        if (rasterizeBtn) rasterizeBtn.disabled = true; 
        return; // Stop initialization if wasm read fails
    }

    // Initialize with the wasm binary data
    PDFiumLibrary.init({ wasmBinary }).then(lib => {
        pdfiumLibrary = lib;
        console.log('@hyzyla/pdfium library initialized successfully.');
        updateStatus('PDF engine ready. Select a PDF file.', 'info');
    }).catch(err => {
        console.error('Failed to initialize @hyzyla/pdfium with wasmBinary:', err);
        updateStatus('Error: Failed to initialize PDF engine.', 'error');
        if (rasterizeBtn) rasterizeBtn.disabled = true; 
    });
    // --- End Initialization ---

    pdfInput.addEventListener('change', function(event) {
        // console.log('File input changed'); // Removed
        if (event.target.files.length > 0) {
            const file = event.target.files[0];
            if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
                selectedFileObject = file;
                rasterizeBtn.disabled = !pdfiumLibrary; 
                if (pdfiumLibrary) {
                    updateStatus('PDF selected, ready to rasterize', 'info');
                } else {
                     updateStatus('PDF selected, but PDF engine is not ready.', 'error');
                }
            } else {
                selectedFileObject = null;
                rasterizeBtn.disabled = true;
                updateStatus('Please select a valid PDF file', 'error');
            }
        } else {
            selectedFileObject = null;
            rasterizeBtn.disabled = true;
            updateStatus('No file selected', 'error');
        }
    });

    rasterizeBtn.addEventListener('click', async function() {
        // console.log('Rasterize button clicked'); // Removed
        if (!selectedFileObject) {
            updateStatus('Please select a PDF file first', 'error');
            return;
        }
        if (!pdfiumLibrary) {
            updateStatus('PDF engine not initialized. Cannot process.', 'error');
            return;
        }
        
        rasterizeBtn.disabled = true;
        updateStatus('Processing PDF...', 'info'); // Simplified message
        
        let pdfDocument = null;
        try {
            const pdfArrayBuffer = await selectedFileObject.arrayBuffer();
            const pdfBuffer = Buffer.from(pdfArrayBuffer);
            // console.log(`Converted to Node.js Buffer (${pdfBuffer.length} bytes)`); // Removed

            pdfDocument = await pdfiumLibrary.loadDocument(pdfBuffer);
            // console.log(`PDF loaded via @hyzyla/pdfium: ${pdfDocument.pageCount} pages`); // Removed

            if (pdfDocument.pageCount < 1) {
                throw new Error('PDF has no pages.');
            }

            const pageIndex = 0; 
            const page = await pdfDocument.getPage(pageIndex);
            // console.log(`Page ${pageIndex + 1} loaded: Size ${page.width}x${page.height} points`); // Removed

            const dpi = 300;
            const scale = dpi / 72;
            // console.log(`Rendering at ${dpi} DPI (scale ${scale.toFixed(2)})...`); // Removed

            const renderResult = await page.render({ scale, render: 'bitmap' }); 
            // console.log('Page rendered via @hyzyla/pdfium (bitmap)'); // Removed

            if (!renderResult || !renderResult.data || !renderResult.width || !renderResult.height) {
                throw new Error('Failed to get valid bitmap data from page.render().');
            }
            // console.log(`Rendered bitmap: ${renderResult.width}x${renderResult.height}, data length: ${renderResult.data?.length}`); // Removed

            updateStatus('Sending rendered image to main process...', 'info');

            const imageBuffer = Buffer.from(renderResult.data.buffer, 
                                             renderResult.data.byteOffset, 
                                             renderResult.data.byteLength);
            // console.log(`Sending Buffer (${imageBuffer.length} bytes) and dimensions via IPC...`); // Removed

            const result = await ipcRenderer.invoke('rasterize-pdf', {
                imageBuffer: imageBuffer, 
                width: renderResult.width,
                height: renderResult.height
            });
            
            // console.log('Result from main process:', result); // Removed
            
            if (result.success) {
                updateStatus(`Successfully rasterized and saved to: ${result.filePath}`, 'success');
            } else {
                updateStatus(`Rasterization failed: ${result.message}`, 'error'); // Simplified message
            }
        } catch (error) {
            console.error('Error during PDF processing or IPC:', error); // Keep error logs
            updateStatus(`Error: ${error.message}`, 'error');
            // Wasm loading errors are less likely if init worked, but keep check
            if (error.message.includes('WebAssembly') || error.message.includes('.wasm')) {
                 updateStatus(`Error: Failed to process with PDFium WebAssembly module. Details: ${error.message}`, 'error');
            }
        } finally {
            // Destroy the document if it was loaded
            if (pdfDocument) {
                // console.log('Destroying PDF document instance'); // Removed
                pdfDocument.destroy();
            }
            // Do NOT destroy the library here if we want to reuse it
            // Library cleanup might happen on app exit if needed

            pdfInput.value = ''; 
            selectedFileObject = null;
            rasterizeBtn.disabled = true;
            // console.log('Process finished, UI reset'); // Removed
        }
    });
    
    function updateStatus(message, type) {
        statusDiv.textContent = message;
        statusDiv.className = `status-${type}`; 
        // console.log(`Status (${type}):`, message); // Keep or remove this based on preference
    }

    updateStatus('Initializing PDF engine...', 'info');
}); 