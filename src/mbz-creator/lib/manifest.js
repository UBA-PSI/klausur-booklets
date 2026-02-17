const fs = require('fs').promises;

/**
 * Updates the sequence in section.xml and optionally the section title.
 * @param {string} sectionXmlPath - Path to section.xml
 * @param {Array<string|number>} allModuleIds - List of module IDs
 * @param {string} [sectionTitle] - Optional new section title
 * @returns {Promise<boolean>} true if changes made or up-to-date, false if error
 */
async function updateSectionXml(sectionXmlPath, allModuleIds, sectionTitle) {
    try {
        const originalContent = await fs.readFile(sectionXmlPath, 'utf8');
        const sequenceStr = allModuleIds.join(',');
        let content = originalContent.replace(/(<sequence>)(.*?)(<\/sequence>)/, (_, p1, _old, p3) => `${p1}${sequenceStr}${p3}`);

        if (sectionTitle) {
            const nameRegex = /(<name>)(.*?)(<\/name>)/;
            const currentTitle = originalContent.match(nameRegex)?.[2];
            if (currentTitle !== undefined && currentTitle !== sectionTitle) {
                content = content.replace(nameRegex, (_, p1, _old, p3) => `${p1}${sectionTitle}${p3}`);
            }
        }

        if (content !== originalContent) {
            await fs.writeFile(sectionXmlPath, content, 'utf8');
        }
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Modifies moodle_backup.xml: filename, backup_id, startdate, activity titles.
 * Simplified: no longer adds new <setting> blocks or creates new activity entries.
 * Only updates existing activity titles and metadata.
 */
async function updateMoodleBackupXml(
    xmlPath,
    outputFilename,
    originalBackupId,
    newBackupId,
    allAssignmentDetails,
    sectionId,
    sectionTitle,
    targetStartTimestamp
) {
    try {
        const originalContent = await fs.readFile(xmlPath, 'utf8');
        let content = originalContent;

        // Helper: apply a regex replacement using a function replacer to avoid $-pattern issues
        function applyReplace(pattern, value) {
            content = content.replace(pattern, (...groups) => {
                // For patterns with 3 capture groups: prefix + old + suffix
                // For patterns with 2 capture groups: prefix + suffix
                // Filter out full match (first), offset, and input string (last two)
                const captures = groups.slice(1, -2);
                if (captures.length === 3) return `${captures[0]}${value}${captures[2]}`;
                if (captures.length === 2) return `${captures[0]}${value}${captures[1]}`;
                return `${captures[0]}${value}`;
            });
        }

        // 1. <information><name>
        applyReplace(/(<information>.*?<name>)(.*?)(<\/name>)/s, outputFilename);

        // 2. <setting> filename
        applyReplace(
            /(<setting>\s*<level>root<\/level>\s*<name>filename<\/name>\s*<value>)(.*?)(<\/value>\s*<\/setting>)/s,
            outputFilename
        );

        // 3. backup_id
        if (originalBackupId) {
            content = content.replace(
                new RegExp(`backup_id="${originalBackupId}"`),
                `backup_id="${newBackupId}"`
            );
        }

        // 4. Section title in <sections>
        if (sectionTitle && sectionId) {
            applyReplace(
                new RegExp(`(<section>\\s*<sectionid>${sectionId}<\\/sectionid>\\s*<title>)(.*?)(<\\/title>)`, 's'),
                sectionTitle
            );
        }

        // 5. Activity titles by moduleid
        for (const details of allAssignmentDetails) {
            const safeTitle = details.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            applyReplace(
                new RegExp(`(<activity>\\s*<moduleid>${details.moduleid}<\\/moduleid>[\\s\\S]*?<title>)(.*?)(<\\/title>)`, 's'),
                safeTitle
            );
        }

        // 6. Course start date
        if (typeof targetStartTimestamp === 'number') {
            const beforeDateUpdate = content;
            applyReplace(/(<original_course_startdate>)(\d+)(<\/original_course_startdate>)/, targetStartTimestamp);
            applyReplace(/(<details>[\s\S]*?<startdate>)(\d+)(<\/startdate>[\s\S]*?<\/details>)/, targetStartTimestamp);
            applyReplace(/(<course\b[^>]*>[\s\S]*?<startdate>)(\d+)(<\/startdate>[\s\S]*?<\/course>)/, targetStartTimestamp);
            // Fallback: replace first generic <startdate> if none of the scoped patterns matched
            if (content === beforeDateUpdate) {
                applyReplace(/(<startdate>)(\d+)(<\/startdate>)/, targetStartTimestamp);
            }
        }

        if (content !== originalContent) {
            await fs.writeFile(xmlPath, content, 'utf8');
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

module.exports = {
    updateSectionXml,
    updateMoodleBackupXml,
};
