// Handles parsing and analysis of the template MBZ file.

const JSZip = require('jszip');
const tar = require('tar');
const zlib = require('zlib');
const { XMLParser } = require('fast-xml-parser');
const fsPromises = require('fs').promises;
const fs = require('fs');
const path = require('path');
const os = require('os');

// Magic numbers for file type detection
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b, 0x08]);

// XML options - consistent with generator
const xmlOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
  parseTagValue: false,       // Keep tag values as strings
  // Important for builder: preserve order for Moodle
  preserveOrder: true,
};

/**
 * Extracts a Zip archive using JSZip.
 */
async function extractZip(zipBuffer, tempDir) {
    console.log('Loading zip data...');
    const zip = await JSZip.loadAsync(zipBuffer);
    console.log('Zip data loaded. Extracting...');

    const extractionPromises = [];
    zip.forEach((relativePath, zipEntry) => {
        if (zipEntry.dir) return;
        const absolutePath = path.join(tempDir, relativePath);
        const dirName = path.dirname(absolutePath);
        const promise = fsPromises.mkdir(dirName, { recursive: true })
            .then(() => zipEntry.async('nodebuffer'))
            .then(content => fsPromises.writeFile(absolutePath, content));
        extractionPromises.push(promise);
    });
    await Promise.all(extractionPromises);
}

/**
 * Extracts a tar.gz archive using tar/zlib streams.
 */
async function extractTarGz(mbzFilePath, tempDir) {
    console.log(`Extracting ${mbzFilePath} (tar.gz) to ${tempDir}...`);
    const readStream = fs.createReadStream(mbzFilePath);
    const gunzipStream = zlib.createGunzip();
    const extractStream = tar.extract({ cwd: tempDir });

    await new Promise((resolve, reject) => {
        readStream.on('error', (err) => reject(new Error(`Read stream error: ${err.message}`)) );
        gunzipStream.on('error', (err) => reject(new Error(`Gunzip stream error: ${err.message}`)) );
        extractStream.on('error', (err) => reject(new Error(`Tar extract stream error: ${err.message}`)) );
        extractStream.on('finish', resolve);
        readStream.pipe(gunzipStream).pipe(extractStream);
    });
}

/**
 * Detects file type and extracts MBZ accordingly, then analyzes structure.
 */
async function analyzeMbzTemplate(mbzFilePath) {
  // Check file existence synchronously before proceeding
  if (!fs.existsSync(mbzFilePath)) {
    throw new Error(`MBZ file not found: ${mbzFilePath}`);
  }

  let tempDir = null; // Define tempDir here to ensure it's available in finally block
  try {
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'mbz-creator-'));
    console.log(`Created temporary directory: ${tempDir}`);
    let potentialSubDir = null; // To handle tarballs with a root folder
    let baseDir = tempDir; // Base directory for parsing XML, might change for tar

    // 1. Detect file type by reading the first few bytes
    console.log(`Detecting file type for ${mbzFilePath}`);
    const fileBuffer = await fsPromises.readFile(mbzFilePath);
    let fileType = 'unknown';

    if (fileBuffer.length >= 4 && fileBuffer.compare(ZIP_MAGIC, 0, ZIP_MAGIC.length, 0, ZIP_MAGIC.length) === 0) {
      fileType = 'zip';
    } else if (fileBuffer.length >= 3 && fileBuffer.compare(GZIP_MAGIC, 0, GZIP_MAGIC.length, 0, GZIP_MAGIC.length) === 0) {
      fileType = 'tar.gz';
    } else {
        // Add more details to the error
        const firstBytes = fileBuffer.slice(0, 10).toString('hex');
        throw new Error(`Unsupported file format. Only Zip (.zip) or Gzipped Tar (.tar.gz) MBZ files are supported. File starts with: ${firstBytes}`);
    }
    console.log(`Detected file type: ${fileType}`);

    // 2. Extract based on file type
    if (fileType === 'zip') {
      await extractZip(fileBuffer, tempDir);
    } else { // tar.gz
      await extractTarGz(mbzFilePath, tempDir);
      // Check for potential single top-level directory within the tarball
      const items = await fsPromises.readdir(tempDir);
      if (items.length === 1) {
          const singleItemPath = path.join(tempDir, items[0]);
          // Use lstat to avoid following symlinks if any exist
          const stats = await fsPromises.lstat(singleItemPath);
          if (stats.isDirectory()) {
              console.warn(`Archive seems to contain a single top-level directory: ${items[0]}. Adjusting base path.`);
              potentialSubDir = items[0];
              baseDir = singleItemPath;
          }
      }
    }
    console.log('Extraction complete.');

    // 3. Parse moodle_backup.xml (using baseDir)
    const backupXmlPath = path.join(baseDir, 'moodle_backup.xml');
    if (!fs.existsSync(backupXmlPath)) {
      throw new Error('Invalid MBZ structure: moodle_backup.xml not found inside the archive.');
    }

    const backupXml = await fsPromises.readFile(backupXmlPath, 'utf8');
    const parser = new XMLParser(xmlOptions);
    const backupData = parser.parse(backupXml);

    // With preserveOrder:true, we get different structure
    const activitiesNode = backupData?.[0]?.moodle_backup?.[0]?.information?.[0]?.contents?.[0]?.activities?.[0];
    const activities = activitiesNode?.activity;

    if (!activities) {
        throw new Error('No activities found in moodle_backup.xml.');
    }
    
    // In preserveOrder:true format, each node is an object with the tag name as a property
    const assignActivities = activities.filter(activityNode => {
        const moduleName = activityNode?.activity?.[0]?.modulename?.[0]?.['#text'];
        return moduleName === 'assign';
    });
    
    if (assignActivities.length === 0) {
      throw new Error('No assignment activities found in the MBZ file.');
    }
    
    const activityNode = assignActivities[0].activity[0];
    const moduleId = activityNode?.moduleid?.[0]?.['#text'];
    const sectionId = activityNode?.sectionid?.[0]?.['#text'];
    const directory = activityNode?.directory?.[0]?.['#text'];
    
    if (!moduleId || !sectionId || !directory) {
        throw new Error('Template activity in moodle_backup.xml is missing required IDs or directory.');
    }
    console.log(`Using template assignment: ModuleID=${moduleId}, SectionID=${sectionId}, RelDir=${directory}`);

    const assignXmlPath = path.join(baseDir, directory, 'assign.xml');
    const sectionBaseDir = path.join(baseDir, 'sections');
    const sectionXmlPath = path.join(sectionBaseDir, `section_${sectionId}`, 'section.xml');

    if (!fs.existsSync(assignXmlPath)) {
      throw new Error(`Invalid MBZ structure: ${path.relative(baseDir, assignXmlPath)} not found.`);
    }
    const assignXml = await fsPromises.readFile(assignXmlPath, 'utf8');
    const assignData = parser.parse(assignXml);
    
    // With preserveOrder:true, we need to navigate through arrays
    const activityElement = assignData.find(item => item.activity);
    const assignElements = activityElement?.activity?.find(item => item.assign);
    const assignDetails = assignElements?.assign?.[0];
    
    if (!assignDetails) {
        throw new Error(`Could not parse details from ${assignXmlPath}`);
    }

    let sectionSequence = '';
    let sectionXmlExists = false;
    try {
        await fsPromises.access(sectionXmlPath, fs.constants.R_OK);
        sectionXmlExists = true;
    } catch (e) {
        console.warn(`Warning: Section file ${path.relative(baseDir, sectionXmlPath)} not found or not readable. Sequence update may be skipped.`);
    }

    if (sectionXmlExists) {
        const sectionXml = await fsPromises.readFile(sectionXmlPath, 'utf8');
        const sectionData = parser.parse(sectionXml);
        const sectionElement = sectionData.find(item => item.section);
        const sequenceElement = sectionElement?.section?.find(item => item.sequence);
        sectionSequence = sequenceElement?.sequence?.[0]?.['#text'] || '';
    }

    // Find name and date properties with the new structure
    const nameElement = assignDetails.name?.[0];
    const nameProp = nameElement?.['#text'];
    
    const duedateElement = assignDetails.duedate?.[0];
    const duedateProp = duedateElement?.['#text'];
    
    const cutoffdateElement = assignDetails.cutoffdate?.[0];
    const cutoffdateProp = cutoffdateElement?.['#text'];
    
    const allowsubmissionsfromdateElement = assignDetails.allowsubmissionsfromdate?.[0];
    const allowsubmissionsfromdateProp = allowsubmissionsfromdateElement?.['#text'];
    
    // Get activity ID and context ID from attributes
    const activityId = activityElement?.[':@']?.['@_id'];
    const contextId = activityElement?.[':@']?.['@_contextid'];

    const templateInfo = {
      tempDir,
      baseDir,
      moduleId,
      sectionId,
      activityId,
      contextId,
      name: nameProp || 'Unknown Assignment',
      dueDate: parseInt(duedateProp) || null,
      cutoffDate: parseInt(cutoffdateProp) || null,
      allowSubmissionsFromDate: parseInt(allowsubmissionsfromdateProp) || null,
      sectionSequence,
      paths: {
        backupXml: backupXmlPath,
        templateAssignDir: path.join(baseDir, directory),
        templateAssignXml: assignXmlPath,
        templateModuleXml: path.join(baseDir, directory, 'module.xml'),
        sectionXml: sectionXmlExists ? sectionXmlPath : null,
        sectionsDir: sectionBaseDir,
        activitiesDir: path.join(baseDir, 'activities')
      }
    };

    if (!templateInfo.activityId || !templateInfo.contextId) {
        throw new Error(`Failed to extract activityId or contextId from ${assignXmlPath}`);
    }

    console.log('Template analysis successful:', { name: templateInfo.name, activityId: templateInfo.activityId });
    return templateInfo;

  } catch (error) {
    console.error(`Error during MBZ analysis: ${error.message}. Cleaning up temp directory.`);
    if (tempDir) {
        try {
          await fsPromises.rm(tempDir, { recursive: true, force: true });
          console.log(`Cleaned up temp directory: ${tempDir}`);
        } catch (cleanupError) {
          console.error(`Failed to cleanup temp directory ${tempDir} after error:`, cleanupError);
        }
    }
    // Re-throw the original error to be handled by the caller
    throw error;
  }
}

module.exports = { analyzeMbzTemplate }; 