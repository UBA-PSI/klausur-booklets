/**
 * ILIAS Exercise Export Generator
 *
 * Generates a ZIP file importable into ILIAS to create an exercise with
 * multiple assignment units (Übungseinheiten).
 */

const path = require('path');
const AdmZip = require('adm-zip');

const INSTALLATION_URL = '';
const INSTALLATION_ID = '0';

function escapeXml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function unescapeXml(str) {
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, '\'')
        .replace(/&#13;\n/g, '\n')
        .replace(/&#13;/g, '');
}

/**
 * Generate pseudo-unique exercise ID and assignment IDs.
 * Uses timestamp + random component to minimize collision risk across users.
 */
function generateIds(numAssignments) {
    const base = Math.floor(Date.now() / 1000) % 100000000;
    const rand = Math.floor(Math.random() * 10000);
    const excId = base * 10000 + rand;
    const assIds = [];
    for (let i = 0; i < numAssignments; i++) {
        assIds.push(excId + 100000 + i);
    }
    return { excId, assIds };
}

/** Check whether a date (1-based month) falls in CEST. System-timezone-independent. */
function isCEST(year, month, day, hour) {
    function lastSundayOfMonth(y, m) {
        const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDay();
        return new Date(Date.UTC(y, m + 1, 0)).getUTCDate() - (last === 0 ? 0 : last);
    }
    const lastSunMarch = lastSundayOfMonth(year, 2);  // m=2 → March (0-based)
    const lastSunOct = lastSundayOfMonth(year, 9);     // m=9 → October
    const val = month * 1000000 + day * 10000 + hour * 100;
    return val >= 3 * 1000000 + lastSunMarch * 10000 + 200
        && val < 10 * 1000000 + lastSunOct * 10000 + 300;
}

/** Convert CET/CEST "YYYY-MM-DD [HH:MM]" to UTC string. Timezone-independent. */
function toUtcString(localDateStr) {
    const str = localDateStr.length === 10 ? localDateStr + ' 00:00' : localDateStr;
    const [datePart, timePart] = str.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);

    const offsetHours = isCEST(year, month, day, hour) ? 2 : 1;

    const utc = new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0));
    const pad = (n) => String(n).padStart(2, '0');
    return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())} ` +
        `${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())}:${pad(utc.getUTCSeconds())}`;
}

/** Build the main exercise export XML. */
function buildExerciseXml(config, excId, assIds) {
    const title = escapeXml(config.exercise_title);
    const description = escapeXml(config.exercise_description);
    const instruction = config.instruction_html;
    let instructionEscaped = escapeXml(instruction);
    instructionEscaped = instructionEscaped.replace(/\n/g, '&#13;\n');

    const mandatory = config.mandatory ? '1' : '0';
    const maxFile = String(Math.max(1, config.max_files || 1));

    const assignments = config.assignments;
    const numUnits = assignments.length;

    const assignmentRecords = [];
    const reminderRecords = [];

    for (let i = 0; i < numUnits; i++) {
        const assId = assIds[i];
        const a = assignments[i];
        const orderNr = (i + 1) * 10;

        const startUtc = toUtcString(a.startDate);
        const deadlineUtc = toUtcString(a.deadlineDate);

        const dsBase = i * 3;
        const instructionDir = `Modules/Exercise/set_1/expDir_1/dsDir_${dsBase + 1}`;
        const feedbackDir = `Modules/Exercise/set_1/expDir_1/dsDir_${dsBase + 2}`;
        const webdataDir = `Modules/Exercise/set_1/expDir_1/dsDir_${dsBase + 3}`;

        assignmentRecords.push(
            '<ds:Rec Entity="exc_assignment"><ExcAssignment>' +
            `<Id>${assId}</Id>` +
            `<ExerciseId>${excId}</ExerciseId>` +
            '<Type>1</Type>' +
            `<Deadline>${deadlineUtc}</Deadline>` +
            '<Deadline2/>' +
            `<Instruction>${instructionEscaped}</Instruction>` +
            `<Title>${escapeXml(a.title)}</Title>` +
            `<StartTime>${startUtc}</StartTime>` +
            `<Mandatory>${mandatory}</Mandatory>` +
            `<OrderNr>${orderNr}</OrderNr>` +
            '<TeamTutor>0</TeamTutor>' +
            `<MaxFile>${maxFile}</MaxFile>` +
            '<Peer>0</Peer>' +
            '<PeerMin>2</PeerMin>' +
            '<PeerDeadline>0</PeerDeadline>' +
            '<PeerFile>0</PeerFile>' +
            '<PeerPersonal>0</PeerPersonal>' +
            '<PeerChar/>' +
            '<PeerUnlock>0</PeerUnlock>' +
            '<PeerValid>1</PeerValid>' +
            '<PeerText>1</PeerText>' +
            '<PeerRating>1</PeerRating>' +
            '<PeerCritCat>0</PeerCritCat>' +
            '<FeedbackFile/>' +
            '<FeedbackCron>0</FeedbackCron>' +
            '<FeedbackDate>1</FeedbackDate>' +
            '<FbDateCustom>0</FbDateCustom>' +
            '<RelDeadlineLastSubm>0</RelDeadlineLastSubm>' +
            '<DeadlineMode>0</DeadlineMode>' +
            '<RelativeDeadline>0</RelativeDeadline>' +
            `<InstructionCollection>${instructionDir}</InstructionCollection>` +
            `<FeedbackDir>${feedbackDir}</FeedbackDir>` +
            `<WebDataDir>${webdataDir}</WebDataDir>` +
            '</ExcAssignment></ds:Rec>'
        );

        for (const reminderType of ['grade', 'submit']) {
            reminderRecords.push(
                '<ds:Rec Entity="exc_ass_reminders"><ExcAssReminders>' +
                `<Type>${reminderType}</Type>` +
                `<AssId>${assId}</AssId>` +
                `<ExcId>${excId}</ExcId>` +
                '<Status>0</Status>' +
                '<Start>0</Start>' +
                '<End/>' +
                '<Freq>0</Freq>' +
                '<LastSend/>' +
                '<TemplateId>0</TemplateId>' +
                '</ExcAssReminders></ds:Rec>'
            );
        }
    }

    return '<?xml version="1.0" encoding="utf-8"?>' +
        '<!--Generated by ILIAS XmlWriter-->' +
        '<exp:Export' +
        ` InstallationId="${INSTALLATION_ID}"` +
        ` InstallationUrl="${INSTALLATION_URL}"` +
        ' Entity="exc" SchemaVersion="9.0"' +
        ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
        ' xmlns:exp="http://www.ilias.de/Services/Export/exp/4_1"' +
        ` xsi:schemaLocation="http://www.ilias.de/Services/Export/exp/4_1 ${INSTALLATION_URL}/xml/ilias_export_4_1.xsd` +
        ` https://www.ilias.de/Modules/Exercise/exc/9 ${INSTALLATION_URL}/xml/ilias_exc_9.xsd` +
        ` http://www.ilias.de/Services/DataSet/ds/4_3 ${INSTALLATION_URL}/xml/ilias_ds_4_3.xsd"` +
        ' xmlns="https://www.ilias.de/Modules/Exercise/exc/9"' +
        ' xmlns:ds="http://www.ilias.de/Services/DataSet/ds/4_3">' +
        `<exp:ExportItem Id="${excId}">` +
        `<ds:DataSet InstallationId="${INSTALLATION_ID}"` +
        ` InstallationUrl="${INSTALLATION_URL}"` +
        ' TopEntity="exc"' +
        ' xmlns:ds="http://www.ilias.de/Services/DataSet/ds/4_3">' +
        '<ds:Rec Entity="exc"><Exc>' +
        `<Id>${excId}</Id>` +
        `<Title>${title}</Title>` +
        `<Description>${description}</Description>` +
        '<PassMode>all</PassMode>' +
        '<PassNr>0</PassNr>' +
        '<ShowSubmissions>0</ShowSubmissions>' +
        '<ComplBySubmission>0</ComplBySubmission>' +
        '<Tfeedback>7</Tfeedback>' +
        '<NrMandatoryRandom>0</NrMandatoryRandom>' +
        '</Exc></ds:Rec>' +
        assignmentRecords.join('') +
        reminderRecords.join('') +
        '</ds:DataSet></exp:ExportItem></exp:Export>';
}

function buildObjectCommonXml(excId) {
    return '<?xml version="1.0" encoding="utf-8"?>' +
        '<!--Generated by ILIAS XmlWriter-->' +
        '<exp:Export' +
        ` InstallationId="${INSTALLATION_ID}"` +
        ` InstallationUrl="${INSTALLATION_URL}"` +
        ' Entity="common" SchemaVersion="5.4.0"' +
        ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
        ' xmlns:exp="http://www.ilias.de/Services/Export/exp/4_1"' +
        ` xsi:schemaLocation="http://www.ilias.de/Services/Export/exp/4_1 ${INSTALLATION_URL}/xml/ilias_export_4_1.xsd` +
        ` http://www.ilias.de/Services/Object/obj/5_4 ${INSTALLATION_URL}/xml/ilias_obj_5_4.xsd` +
        ` http://www.ilias.de/Services/DataSet/ds/4_3 ${INSTALLATION_URL}/xml/ilias_ds_4_3.xsd"` +
        ' xmlns="http://www.ilias.de/Services/Object/obj/5_4"' +
        ' xmlns:ds="http://www.ilias.de/Services/DataSet/ds/4_3">' +
        `<exp:ExportItem Id="${excId}">` +
        `<ds:DataSet InstallationId="${INSTALLATION_ID}"` +
        ` InstallationUrl="${INSTALLATION_URL}"` +
        ' TopEntity="common"' +
        ' xmlns:ds="http://www.ilias.de/Services/DataSet/ds/4_3">' +
        '<ds:Rec Entity="common"><Common>' +
        `<ObjId>${excId}</ObjId>` +
        '</Common></ds:Rec>' +
        '</ds:DataSet></exp:ExportItem></exp:Export>';
}

function buildServiceSettingsXml(excId) {
    return '<?xml version="1.0" encoding="utf-8"?>' +
        '<!--Generated by ILIAS XmlWriter-->' +
        '<exp:Export' +
        ` InstallationId="${INSTALLATION_ID}"` +
        ` InstallationUrl="${INSTALLATION_URL}"` +
        ' Entity="service_settings" SchemaVersion="5.4.0"' +
        ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
        ' xmlns:exp="http://www.ilias.de/Services/Export/exp/4_1"' +
        ` xsi:schemaLocation="http://www.ilias.de/Services/Export/exp/4_1 ${INSTALLATION_URL}/xml/ilias_export_4_1.xsd` +
        ` http://www.ilias.de/Services/Object/obj/5_4 ${INSTALLATION_URL}/xml/ilias_obj_5_4.xsd` +
        ` http://www.ilias.de/Services/DataSet/ds/4_3 ${INSTALLATION_URL}/xml/ilias_ds_4_3.xsd"` +
        ' xmlns="http://www.ilias.de/Services/Object/obj/5_4"' +
        ' xmlns:ds="http://www.ilias.de/Services/DataSet/ds/4_3">' +
        `<exp:ExportItem Id="${excId}">` +
        `<ds:DataSet InstallationId="${INSTALLATION_ID}"` +
        ` InstallationUrl="${INSTALLATION_URL}"` +
        ' TopEntity="service_settings"' +
        ' xmlns:ds="http://www.ilias.de/Services/DataSet/ds/4_3">' +
        '</ds:DataSet></exp:ExportItem></exp:Export>';
}

function buildMetadataXml(config, excId) {
    const title = escapeXml(config.exercise_title);
    const description = escapeXml(config.exercise_description);
    return '<?xml version="1.0" encoding="utf-8"?>' +
        '<!--Generated by ILIAS XmlWriter-->' +
        '<exp:Export' +
        ` InstallationId="${INSTALLATION_ID}"` +
        ` InstallationUrl="${INSTALLATION_URL}"` +
        ' Entity="md" SchemaVersion="4.1.0"' +
        ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
        ' xmlns:exp="http://www.ilias.de/Services/Export/exp/4_1"' +
        ` xsi:schemaLocation="http://www.ilias.de/Services/Export/exp/4_1 ${INSTALLATION_URL}/xml/ilias_export_4_1.xsd` +
        ` http://www.ilias.de/Services/MetaData/meta/4_1 ${INSTALLATION_URL}/xml/ilias_meta_4_1.xsd"` +
        ' xmlns="http://www.ilias.de/Services/MetaData/meta/4_1">' +
        `<exp:ExportItem Id="${excId}:0:exc">` +
        '<MetaData><General Structure="Hierarchical">' +
        `<Identifier Catalog="ILIAS" Entry="il_${INSTALLATION_ID}_exc_${excId}"/>` +
        `<Title Language="de">${title}</Title>` +
        '<Language Language="de"/>' +
        `<Description Language="de">${description}</Description>` +
        '<Keyword Language="de"></Keyword>' +
        '</General></MetaData>' +
        '</exp:ExportItem></exp:Export>';
}

function buildManifestXml(config) {
    const title = escapeXml(config.exercise_title);
    return '<?xml version="1.0" encoding="utf-8"?>' +
        '<!--Generated by ILIAS XmlWriter-->' +
        `<Manifest MainEntity="exc" Title="${title}"` +
        ` InstallationId="${INSTALLATION_ID}"` +
        ` InstallationUrl="${INSTALLATION_URL}">` +
        '<ExportFile Component="Modules/Exercise" Path="Modules/Exercise/set_1/export.xml"/>' +
        '<ExportFile Component="Services/Object" Path="Services/Object/set_1/export.xml"/>' +
        '<ExportFile Component="Services/MetaData" Path="Services/MetaData/set_1/export.xml"/>' +
        '<ExportFile Component="Services/Object" Path="Services/Object/set_2/export.xml"/>' +
        '</Manifest>';
}

/**
 * Generate an ILIAS exercise export ZIP.
 *
 * @param {Object} config - Exercise configuration
 * @param {string} config.exercise_title - Exercise title
 * @param {string} config.exercise_description - Exercise description
 * @param {string} config.instruction_html - HTML instruction for assignments
 * @param {boolean} [config.mandatory=false] - Whether assignments are mandatory
 * @param {number} [config.max_files=1] - Max file uploads per assignment
 * @param {Array<{title: string, startDate: string, deadlineDate: string}>} config.assignments
 *   Array of assignment units, each with title, startDate (YYYY-MM-DD HH:MM), deadlineDate (YYYY-MM-DD HH:MM)
 * @param {string} outputPath - Path for the output ZIP file
 * @returns {Object} - { excId, numUnits, outputPath }
 */
function generateIliasExerciseZip(config, outputPath) {
    const numUnits = config.assignments.length;
    const ids = generateIds(numUnits);
    const excId = ids.excId;
    const assIds = ids.assIds;

    const zipPrefix = path.basename(outputPath, '.zip');

    const zip = new AdmZip();

    zip.addFile(`${zipPrefix}/manifest.xml`, Buffer.from(buildManifestXml(config), 'utf-8'));
    zip.addFile(`${zipPrefix}/Modules/Exercise/set_1/export.xml`, Buffer.from(buildExerciseXml(config, excId, assIds), 'utf-8'));
    for (let i = 0; i < numUnits; i++) {
        const dsBase = i * 3;
        for (let j = 1; j <= 3; j++) {
            zip.addFile(`${zipPrefix}/Modules/Exercise/set_1/expDir_1/dsDir_${dsBase + j}/`, Buffer.alloc(0));
        }
    }
    zip.addFile(`${zipPrefix}/Services/Object/set_1/export.xml`, Buffer.from(buildObjectCommonXml(excId), 'utf-8'));
    zip.addFile(`${zipPrefix}/Services/Object/set_2/export.xml`, Buffer.from(buildServiceSettingsXml(excId), 'utf-8'));
    zip.addFile(`${zipPrefix}/Services/MetaData/set_1/export.xml`, Buffer.from(buildMetadataXml(config, excId), 'utf-8'));

    zip.writeZip(outputPath);

    return { excId, numUnits, outputPath };
}

/** Parse an ILIAS exercise export ZIP. */
function parseIliasExerciseZip(zipPath) {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    let exerciseXml = null;
    for (const entry of entries) {
        if (entry.entryName.match(/Modules\/Exercise\/set_1\/export\.xml$/)) {
            exerciseXml = entry.getData().toString('utf-8');
            break;
        }
    }

    if (!exerciseXml) {
        throw new Error('No exercise export.xml found in ZIP. Is this a valid ILIAS exercise export?');
    }

    const titleMatch = exerciseXml.match(/<Exc>[\s\S]*?<Title>(.*?)<\/Title>/);
    const descMatch = exerciseXml.match(/<Exc>[\s\S]*?<Description>(.*?)<\/Description>/);

    // Regex-based: sufficient for well-defined ILIAS export format
    const assignmentBlocks = exerciseXml.match(/<ExcAssignment>[\s\S]*?<\/ExcAssignment>/g) || [];
    const assignments = assignmentBlocks.map(block => {
        const get = (tag) => {
            const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
            return m ? unescapeXml(m[1]) : '';
        };
        return {
            title: get('Title'),
            instruction_html: get('Instruction'),
            startTime: get('StartTime'),
            deadline: get('Deadline'),
            orderNr: parseInt(get('OrderNr') || '0', 10),
        };
    });

    assignments.sort((a, b) => a.orderNr - b.orderNr);

    const instrMatch = exerciseXml.match(/<Instruction>([\s\S]*?)<\/Instruction>/);

    return {
        exercise_title: titleMatch ? unescapeXml(titleMatch[1]) : '',
        exercise_description: descMatch ? unescapeXml(descMatch[1]) : '',
        instruction_html: instrMatch ? unescapeXml(instrMatch[1]) : '',
        assignments,
    };
}

module.exports = {
    generateIliasExerciseZip,
    parseIliasExerciseZip,
    generateIds,
    toUtcString,
};
