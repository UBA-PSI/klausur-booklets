const fs = require('fs').promises;

/**
 * Parses assignment data from an existing assign.xml file.
 * @param {string} filePath - Path to assign.xml
 * @param {string} moduleId - The module ID (from the directory name assign_XXXX)
 * @returns {Promise<Object|null>} Parsed assignment data or null on error
 */
async function parseAssignment(filePath, moduleId) {
    try {
        const content = await fs.readFile(filePath, 'utf8');

        const name = content.match(/<name>(.*?)<\/name>/)?.[1] || '';
        const duedate = parseInt(content.match(/<duedate>(\d+)<\/duedate>/)?.[1] || '0', 10);
        const cutoffdate = parseInt(content.match(/<cutoffdate>(\d+)<\/cutoffdate>/)?.[1] || '0', 10);
        const allowsubmissionsfromdate = parseInt(
            content.match(/<allowsubmissionsfromdate>(\d+)<\/allowsubmissionsfromdate>/)?.[1] || '0', 10
        );

        return {
            moduleId,
            name,
            duedate,
            cutoffdate,
            allowsubmissionsfromdate,
        };
    } catch (e) {
        return null;
    }
}

/**
 * Modifies name, duedate, cutoffdate, and allowsubmissionsfromdate in an existing assign.xml.
 * @param {string} filePath - Path to assign.xml
 * @param {string} newName
 * @param {number} newDueTs
 * @param {number} newCutoffTs
 * @param {number} [newActivationTs] (optional)
 * @returns {Promise<boolean>} true if modified, false otherwise
 */
async function modifyAssignment(filePath, newName, newDueTs, newCutoffTs, newActivationTs) {
    let content = await fs.readFile(filePath, 'utf8');
    const originalContent = content;

    content = content.replace(/(<name>)(.*?)(<\/name>)/, (_, p1, _old, p3) => `${p1}${newName}${p3}`);
    content = content.replace(/(<duedate>)(.*?)(<\/duedate>)/, `$1${newDueTs}$3`);
    content = content.replace(/(<cutoffdate>)(.*?)(<\/cutoffdate>)/, `$1${newCutoffTs}$3`);
    if (typeof newActivationTs === 'number') {
        content = content.replace(/(<allowsubmissionsfromdate>)(.*?)(<\/allowsubmissionsfromdate>)/, `$1${newActivationTs}$3`);
    }

    if (content !== originalContent) {
        await fs.writeFile(filePath, content, 'utf8');
        return true;
    }
    return false;
}

module.exports = {
    parseAssignment,
    modifyAssignment,
};
