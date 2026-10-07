// The universal macOS build needs the sharp binaries for both architectures in node_modules.
// npm only installs the ones matching the build machine, so add the other pair explicitly.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const sharpPackageJson = path.join(__dirname, '../node_modules/sharp/package.json');
const { optionalDependencies } = JSON.parse(fs.readFileSync(sharpPackageJson, 'utf8'));
const packages = Object.entries(optionalDependencies)
    .filter(([name]) => /^@img\/sharp-(libvips-)?darwin-(x64|arm64)$/.test(name))
    .map(([name, version]) => `${name}@${version}`);

if (packages.length !== 4) {
    throw new Error(`Expected 4 darwin sharp packages, found: ${packages.join(', ')}`);
}
console.log(`[sharp] Installing ${packages.join(', ')}`);
execFileSync('npm', ['install', '--force', '--no-save', ...packages], { stdio: 'inherit' });
