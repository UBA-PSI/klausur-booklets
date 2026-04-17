const { execFileSync } = require('child_process');

exports.default = async function afterAllArtifactBuild(buildResult) {
    const dmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith('.dmg'));
    if (dmgs.length === 0) return [];

    const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
    if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
        console.warn('[notarize-dmg] Skipping: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not all set in env.');
        return [];
    }

    for (const dmg of dmgs) {
        console.log(`[notarize-dmg] Submitting ${dmg} to Apple…`);
        execFileSync(
            'xcrun',
            [
                'notarytool', 'submit', dmg,
                '--apple-id', APPLE_ID,
                '--password', APPLE_APP_SPECIFIC_PASSWORD,
                '--team-id', APPLE_TEAM_ID,
                '--wait'
            ],
            { stdio: 'inherit' }
        );

        console.log(`[notarize-dmg] Stapling ${dmg}…`);
        execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' });
    }

    return [];
};
