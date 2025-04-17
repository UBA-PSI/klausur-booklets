const { extractMbz, createMbz } = require('../lib/archive');
const { deleteDotfiles } = require('../lib/fileHelpers');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { existsSync } = require('fs');

// Helper: Recursively list all files/dirs in a directory
async function listDirTree(dir, base = dir) {
  let results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = path.relative(base, path.join(dir, entry.name));
    results.push(relPath + (entry.isDirectory() ? '/' : ''));
    if (entry.isDirectory()) {
      results = results.concat(await listDirTree(path.join(dir, entry.name), base));
    }
  }
  return results.sort();
}

async function main() {
  const sampleMbz = path.resolve('sample.mbz');
  if (!existsSync(sampleMbz)) {
    console.error('sample.mbz not found in project root.');
    process.exit(1);
  }

  const tmp1 = await fs.mkdtemp(path.join(os.tmpdir(), 'mbztest1-'));
  const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'mbztest2-'));
  const repackedMbz = path.join(os.tmpdir(), `mbztest-repacked-${Date.now()}.mbz`);

  try {
    // Extract
    await extractMbz(sampleMbz, tmp1);
    // Delete dotfiles
    await deleteDotfiles(tmp1);
    // Repack
    await createMbz(tmp1, repackedMbz);
    // Extract repacked
    await extractMbz(repackedMbz, tmp2);

    // Compare directory trees
    const tree1 = await listDirTree(tmp1);
    const tree2 = await listDirTree(tmp2);
    const same = JSON.stringify(tree1) === JSON.stringify(tree2);
    console.log('Original extracted tree:', tree1);
    console.log('Repacked extracted tree:', tree2);
    if (same) {
      console.log('✅ Directory trees match after extract/delete/repack/extract.');
    } else {
      console.error('❌ Directory trees do NOT match!');
    }
  } finally {
    // Cleanup
    await fs.rm(tmp1, { recursive: true, force: true });
    await fs.rm(tmp2, { recursive: true, force: true });
    if (existsSync(repackedMbz)) await fs.unlink(repackedMbz);
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
} 