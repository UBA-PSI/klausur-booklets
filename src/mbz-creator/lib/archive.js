const tar = require('tar');
const fs = require('fs');
const path = require('path');

/**
 * Extracts a .mbz (tar.gz) file to the specified directory.
 * @param {string} mbzPath - Path to the .mbz file
 * @param {string} extractTo - Directory to extract to
 */
async function extractMbz(mbzPath, extractTo) {
  try {
    await tar.extract({
      file: mbzPath,
      cwd: extractTo,
      strict: true,
    });
  } catch (err) {
    throw new Error(`Failed to extract ${mbzPath}: ${err.message}`);
  }
}

/**
 * Creates a .mbz (tar.gz) file from the specified directory.
 * @param {string} sourceDir - Directory to archive
 * @param {string} outputPath - Output .mbz file path
 */
async function createMbz(sourceDir, outputPath) {
  try {
    await tar.create({
      gzip: true,
      file: outputPath,
      cwd: sourceDir,
      portable: true,
      noMtime: true,
    }, ['.']);
  } catch (err) {
    throw new Error(`Failed to create archive ${outputPath}: ${err.message}`);
  }
}

module.exports = {
  extractMbz,
  createMbz,
}; 