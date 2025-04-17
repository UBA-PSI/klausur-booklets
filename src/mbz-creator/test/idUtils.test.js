const { extractMbz } = require('../lib/archive');
const { extractIds } = require('../lib/idUtils');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { existsSync } = require('fs');

async function main() {
  const sampleMbz = path.resolve('sample.mbz');
  if (!existsSync(sampleMbz)) {
    console.error('sample.mbz not found in project root.');
    process.exit(1);
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbz-idtest-'));

  try {
    await extractMbz(sampleMbz, tmpDir);
    const ids = await extractIds(tmpDir);
    console.log('Extracted IDs:', ids);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
} 