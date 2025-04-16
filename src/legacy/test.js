const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

async function testCopy() {
    const originalPdfBytes = await fs.promises.readFile('test-pdfs/test.pdf');
    const originalPdf = await PDFDocument.load(originalPdfBytes);
    const newPdf = await PDFDocument.create();
    
    const [copiedPage] = await newPdf.copyPages(originalPdf, [0]);
    
	const sizeObj = copiedPage.getSize();
	const sizeArray = [sizeObj.width, sizeObj.height];
	console.log('Copied page size:', sizeArray);

	if (Array.isArray(sizeArray) && sizeArray.length === 2 && !isNaN(sizeArray[0]) && !isNaN(sizeArray[1])) {
	    newPdf.addPage(sizeArray);
	} else {
	    throw new Error(`Invalid page size: ${sizeArray}`);
	}
    
    
    const outputBytes = await newPdf.save();
    await fs.promises.writeFile('test-pdfs/output.pdf', outputBytes);
}

testCopy().then(() => {
    console.log('Test completed');
}).catch(error => {
    console.error('Error in test:', error);
});
