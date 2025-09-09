#!/usr/bin/env node

/**
 * PDF Analyzer Debug Tool
 * 
 * This standalone script helps debug PDF files that cause 
 * "Failed to get valid bitmap data from page.render()." errors.
 * 
 * Usage: node debug-pdf-analyzer.js path/to/your/problematic.pdf
 */

const fs = require('fs');
const path = require('path');

// Import the PDF processor module
const { analyzePdfFile } = require('./src/js/pdf-cmdline-processor');

/**
 * Perform deep analysis of PDF content to identify PDFium WASM incompatibilities
 */
async function performDeepAnalysis(pdfPath) {
  const deepIssues = [];
  const deepRecommendations = [];
  
  try {
    // Read PDF as binary to check for specific characteristics
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfContent = pdfBuffer.toString('latin1'); // Use latin1 to preserve binary data
    
    // Check PDF version
    const pdfVersionMatch = pdfContent.match(/%PDF-(\d+)\.(\d+)/);
    if (pdfVersionMatch) {
      const majorVersion = parseInt(pdfVersionMatch[1]);
      const minorVersion = parseInt(pdfVersionMatch[2]);
      console.log(`   PDF Version: ${majorVersion}.${minorVersion}`);
      
      if (majorVersion > 1 || (majorVersion === 1 && minorVersion > 7)) {
        deepIssues.push(`Modern PDF version (${majorVersion}.${minorVersion}) may use features unsupported by PDFium WASM`);
      }
    }
    
    // Check for problematic PDF features
    const problematicFeatures = [
      { pattern: /\/XObject/, name: 'XObjects (images/forms)', severity: 'low' },
      { pattern: /\/SMask/, name: 'Soft masks (transparency)', severity: 'medium' },
      { pattern: /\/BM\s*\//, name: 'Blend modes', severity: 'medium' },
      { pattern: /\/CA\s+/, name: 'Constant alpha (transparency)', severity: 'medium' },
      { pattern: /\/OC\s+/, name: 'Optional Content (layers)', severity: 'low' },
      { pattern: /\/Shading/, name: 'Complex shading patterns', severity: 'high' },
      { pattern: /\/Pattern/, name: 'Pattern fills', severity: 'medium' },
      { pattern: /\/JS\s*\(/, name: 'JavaScript', severity: 'high' },
      { pattern: /\/AcroForm/, name: 'Interactive forms', severity: 'medium' },
      { pattern: /\/Annot/, name: 'Annotations', severity: 'low' },
      { pattern: /\/Encrypt/, name: 'Encryption/Password protection', severity: 'high' },
      { pattern: /\/XRef/, name: 'Cross-reference streams', severity: 'medium' },
      { pattern: /\/ObjStm/, name: 'Object streams (compressed)', severity: 'medium' },
      { pattern: /\/FlateDecode.*\/FlateDecode/, name: 'Multiple compression layers', severity: 'medium' },
      { pattern: /\/JBIG2Decode/, name: 'JBIG2 image compression', severity: 'high' },
      { pattern: /\/JPXDecode/, name: 'JPEG2000 image compression', severity: 'high' },
    ];
    
    const detectedFeatures = [];
    for (const feature of problematicFeatures) {
      if (feature.pattern.test(pdfContent)) {
        detectedFeatures.push(feature);
        
        if (feature.severity === 'high') {
          deepIssues.push(`🔴 HIGH RISK: Contains ${feature.name} - known to cause PDFium WASM failures`);
        } else if (feature.severity === 'medium') {
          deepIssues.push(`🟡 MEDIUM RISK: Contains ${feature.name} - may cause PDFium WASM issues`);
        } else {
          console.log(`   🟢 Contains ${feature.name} (usually compatible)`);
        }
      }
    }
    
    // Check for large embedded content
    const imageMatches = pdfContent.match(/\/Length\s+(\d+)/g);
    if (imageMatches) {
      const lengths = imageMatches.map(match => parseInt(match.match(/\d+/)[0]));
      const maxLength = Math.max(...lengths);
      const totalLength = lengths.reduce((sum, len) => sum + len, 0);
      
      if (maxLength > 10 * 1024 * 1024) { // > 10MB single object
        deepIssues.push(`🔴 Very large embedded object (${Math.round(maxLength / (1024*1024))} MB) - may cause memory issues`);
      }
      
      if (totalLength > 50 * 1024 * 1024) { // > 50MB total embedded content
        deepIssues.push(`🟡 High total embedded content (${Math.round(totalLength / (1024*1024))} MB)`);
      }
    }
    
    // Check for unusual page structure
    const pageMatches = pdfContent.match(/\/Type\s*\/Page[^s]/g);
    if (pageMatches && pageMatches.length > 0) {
      console.log(`   Page objects found: ${pageMatches.length}`);
    }
    
    // Check for font issues
    const fontMatches = pdfContent.match(/\/BaseFont\s*\/([^\s\/\]>]+)/g);
    if (fontMatches) {
      const uniqueFonts = [...new Set(fontMatches.map(match => match.replace(/\/BaseFont\s*\//, '')))];
      console.log(`   Fonts used: ${uniqueFonts.length} (${uniqueFonts.slice(0, 3).join(', ')}${uniqueFonts.length > 3 ? '...' : ''})`);
      
      if (uniqueFonts.length > 20) {
        deepIssues.push(`🟡 Many fonts used (${uniqueFonts.length}) - may increase rendering complexity`);
      }
    }
    
    // Generate specific recommendations based on detected issues
    if (detectedFeatures.some(f => f.severity === 'high')) {
      deepRecommendations.push('🚨 CRITICAL: This PDF contains features that are incompatible with PDFium WASM');
      deepRecommendations.push('✅ SOLUTION: Use Ghostscript renderer (should work perfectly)');
    } else if (detectedFeatures.some(f => f.severity === 'medium')) {
      deepRecommendations.push('⚠️  This PDF contains features that may cause PDFium WASM instability');
      deepRecommendations.push('✅ TRY: Switch to Ghostscript renderer for reliability');
    }
    
    if (deepIssues.length === 0) {
      console.log(`   🤔 No obvious content issues detected - this suggests a PDFium WASM library bug`);
      deepRecommendations.push('This may be a PDFium WASM library limitation with this specific PDF structure');
      deepRecommendations.push('Try Ghostscript renderer as a workaround');
    }
    
  } catch (error) {
    deepIssues.push(`Deep analysis failed: ${error.message}`);
  }
  
  return { issues: deepIssues, recommendations: deepRecommendations };
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
PDF Analyzer Debug Tool
=======================

Usage: node debug-pdf-analyzer.js <pdf-file-path> [pdf-file-path2] [...]

This tool analyzes PDF files to identify potential issues that might cause
rendering failures with the PDFium WASM renderer.

Examples:
  node debug-pdf-analyzer.js problematic-file.pdf
  node debug-pdf-analyzer.js file1.pdf file2.pdf file3.pdf
`);
    process.exit(1);
  }

  console.log('🔍 PDF Analysis Tool - Debugging Rendering Issues\n');
  
  for (const pdfPath of args) {
    console.log('═'.repeat(80));
    console.log(`📄 Analyzing: ${pdfPath}`);
    console.log('═'.repeat(80));
    
    try {
      if (!fs.existsSync(pdfPath)) {
        console.log(`❌ File not found: ${pdfPath}\n`);
        continue;
      }

      const analysis = await analyzePdfFile(pdfPath);
      
      // Perform additional deep analysis
      console.log(`🔬 Performing Deep Analysis...`);
      const deepAnalysis = await performDeepAnalysis(pdfPath);
      
      // Display file information
      console.log(`📊 File Information:`);
      console.log(`   File Size: ${analysis.fileSizeMB} MB (${analysis.fileSize.toLocaleString()} bytes)`);
      console.log(`   Page Count: ${analysis.pageCount}`);
      
      if (analysis.firstPageDimensions) {
        console.log(`   Page Dimensions: ${analysis.firstPageDimensions.width} x ${analysis.firstPageDimensions.height} points`);
        console.log(`                   (${analysis.firstPageDimensions.widthInches}" x ${analysis.firstPageDimensions.heightInches}" inches)`);
      }
      
      // Risk assessment
      const riskEmoji = {
        'low': '🟢',
        'medium': '🟡', 
        'high': '🔴'
      };
      
      console.log(`\n${riskEmoji[analysis.riskLevel]} Risk Level: ${analysis.riskLevel.toUpperCase()}`);
      
      // Potential issues (basic analysis)
      if (analysis.potentialIssues.length > 0) {
        console.log(`\n⚠️  Basic Analysis - Potential Issues:`);
        analysis.potentialIssues.forEach((issue, index) => {
          console.log(`   ${index + 1}. ${issue}`);
        });
      } else {
        console.log(`\n✅ Basic Analysis - No obvious issues detected`);
      }
      
      // Deep analysis issues
      if (deepAnalysis.issues.length > 0) {
        console.log(`\n🔬 Deep Content Analysis - Issues Found:`);
        deepAnalysis.issues.forEach((issue, index) => {
          console.log(`   ${index + 1}. ${issue}`);
        });
      } else {
        console.log(`\n🔬 Deep Content Analysis - No problematic features detected`);
      }
      
      // Recommendations (combine both analyses)
      console.log(`\n💡 Recommendations:`);
      const allRecommendations = [...analysis.recommendations, ...deepAnalysis.recommendations];
      const uniqueRecommendations = [...new Set(allRecommendations)];
      uniqueRecommendations.forEach((rec, index) => {
        console.log(`   ${index + 1}. ${rec}`);
      });
      
      // Summary and next steps
      console.log(`\n📋 Summary:`);
      const hasHighRiskFeatures = deepAnalysis.issues.some(issue => issue.includes('HIGH RISK'));
      const hasMediumRiskFeatures = deepAnalysis.issues.some(issue => issue.includes('MEDIUM RISK'));
      
      if (hasHighRiskFeatures) {
        console.log(`   🚨 CRITICAL: This PDF contains features incompatible with PDFium WASM.`);
        console.log(`   🔧 SOLUTION: Switch to Ghostscript renderer in Settings > PDF Processing.`);
        console.log(`   📊 Expected result: Should work perfectly with Ghostscript.`);
      } else if (hasMediumRiskFeatures || analysis.riskLevel === 'high') {
        console.log(`   ⚠️  This PDF may cause issues with PDFium WASM renderer.`);
        console.log(`   🔧 SOLUTION: Try Ghostscript renderer if PDFium fails.`);
        console.log(`   📊 Expected result: Likely to work with Ghostscript.`);
      } else if (analysis.riskLevel === 'medium') {
        console.log(`   🟡 This PDF may cause intermittent issues with PDFium WASM.`);
        console.log(`   🔧 SOLUTION: Try Ghostscript renderer for reliability.`);
      } else {
        console.log(`   🤔 This PDF appears compatible but still fails with PDFium WASM.`);
        console.log(`   💡 This suggests a PDFium WASM library limitation or bug.`);
        console.log(`   🔧 SOLUTION: Use Ghostscript renderer as a reliable workaround.`);
      }
      
      console.log('');
      
    } catch (error) {
      console.log(`❌ Analysis failed for ${pdfPath}:`);
      console.log(`   Error: ${error.message}`);
      console.log(`   This likely indicates the PDF is corrupted or uses unsupported features.`);
      console.log(`   🔧 SOLUTION: Try Ghostscript renderer or use a different PDF.\n`);
    }
  }
  
  // Overall recommendations
  console.log('═'.repeat(80));
  console.log('🎯 How to Fix Rendering Issues:');
  console.log('═'.repeat(80));
  console.log('1. Switch to Ghostscript Renderer:');
  console.log('   - Open your app');
  console.log('   - Go to Settings > PDF Processing');
  console.log('   - Change "PDF Renderer" from "PDFium WASM" to "Ghostscript"');
  console.log('   - Click "Save Settings"');
  console.log('');
  console.log('2. Alternative Solutions:');
  console.log('   - Try reducing DPI (150-200 instead of 300)');
  console.log('   - Process PDFs in smaller batches');
  console.log('   - Use PDF optimization tools to reduce file size');
  console.log('');
  console.log('3. If Ghostscript is not available:');
  console.log('   - Windows: Bundled Ghostscript should work automatically');
  console.log('   - macOS: Bundled Ghostscript should work automatically');
  console.log('   - Linux: Install ghostscript via package manager (apt install ghostscript)');
  console.log('');
}

// Run the analyzer
main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
