const { extractMbz } = require('../lib/archive');
const { extractManifestIds } = require('../lib/idUtils');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { existsSync } = require('fs');
const assert = require('assert');

async function main() {
    const sampleMbz = path.resolve('sample.mbz');
    if (!existsSync(sampleMbz)) {
        console.error('sample.mbz not found in project root.');
        process.exit(1);
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbz-idtest-'));

    try {
        await extractMbz(sampleMbz, tmpDir);
        const ids = await extractManifestIds(tmpDir);

        assert(ids.section_id, 'section_id should be extracted');
        assert(Array.isArray(ids.existing_module_ids), 'existing_module_ids should be an array');
        assert(ids.existing_module_ids.length > 0, 'should find at least one module ID');
        assert(ids.existing_module_ids.every(id => /^\d+$/.test(id)), 'all module IDs should be numeric strings');

        // original_backup_id may or may not be present depending on the MBZ
        if (ids.original_backup_id) {
            assert(/^[a-f0-9]+$/.test(ids.original_backup_id), 'backup_id should be hex string');
        }

        console.log('Extracted IDs:', {
            section_id: ids.section_id,
            module_count: ids.existing_module_ids.length,
            module_ids: ids.existing_module_ids,
            original_backup_id: ids.original_backup_id || '(not found)',
        });
        console.log('✅ extractManifestIds assertions passed.');
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}

if (require.main === module) {
    main().catch(e => { console.error(e); process.exit(1); });
}
