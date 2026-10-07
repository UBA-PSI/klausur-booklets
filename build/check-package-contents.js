// electron-builder afterPack hook: abort the build if the packaged app contains anything
// besides the app itself. Releases up to v1.9.0 shipped the whole project directory in
// app.asar, including .env and student data, because nobody looked inside.
const fs = require('fs');
const path = require('path');
// Both come with electron-builder, which is what runs this hook.
const asar = require('@electron/asar');
const { Arch } = require('builder-util');

const ALLOWED_TOP_LEVEL = new Set(['index.html', 'LICENSE.txt', 'package.json', 'src', 'node_modules']);
// Checked outside node_modules only.
const FORBIDDEN = [
    { pattern: /(^|\/)\.env[^/]*$/, reason: 'environment file (credentials)' },
    { pattern: /(^|\/)\.claude(\/|$)/, reason: 'local tool settings' },
    { pattern: /\.(pdf|mbz|zip|csv|log|heic|jpe?g)$/i, reason: 'data file' },
    { pattern: /(^|\/)test(data[^/]*)?(\/|$)/, reason: 'test files' }
];

exports.default = async function checkPackageContents(context) {
    const platform = context.electronPlatformName;
    const resourcesDir = platform === 'darwin'
        ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
        : path.join(context.appOutDir, 'resources');
    const asarPath = path.join(resourcesDir, 'app.asar');
    if (!fs.existsSync(asarPath)) {
        throw new Error(`[check-package] app.asar not found at ${asarPath}`);
    }

    const entries = asar.listPackage(asarPath).map((entry) => entry.split(path.sep).join('/').replace(/^\//, ''));
    const problems = [];

    const topLevel = new Set(entries.map((entry) => entry.split('/')[0]));
    for (const name of topLevel) {
        if (!ALLOWED_TOP_LEVEL.has(name)) {
            problems.push(`unexpected top-level entry: ${name}`);
        }
    }
    for (const entry of entries) {
        if (entry.startsWith('node_modules/')) continue;
        const hit = FORBIDDEN.find(({ pattern }) => pattern.test(entry));
        if (hit) {
            problems.push(`${hit.reason}: ${entry}`);
        }
    }

    // sharp must be bundled for every architecture this package runs on.
    const archName = Arch[context.arch];
    const sharpArchs = platform === 'darwin' && archName === 'universal' ? ['x64', 'arm64'] : [archName];
    const sharpPlatform = platform === 'win32' ? 'win32' : platform;
    for (const arch of sharpArchs) {
        const sharpDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', '@img', `sharp-${sharpPlatform}-${arch}`);
        if (!fs.existsSync(sharpDir)) {
            problems.push(`sharp binary missing for ${sharpPlatform}-${arch} (expected ${path.relative(context.appOutDir, sharpDir)})`);
        }
    }

    if (problems.length > 0) {
        const shown = problems.slice(0, 20).map((p) => `  - ${p}`).join('\n');
        const more = problems.length > 20 ? `\n  ... and ${problems.length - 20} more` : '';
        throw new Error(`[check-package] ${platform}/${archName}: package contents rejected:\n${shown}${more}\n` +
            'Fix build.files in package.json (or the sharp install) before releasing.');
    }
    console.log(`[check-package] ${platform}/${archName}: ${entries.length} entries, contents OK`);
};
