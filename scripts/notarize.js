const { notarize } = require('@electron/notarize');
exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;
  await notarize({
    appBundleId: 'your.app.bundle.id',
    appPath: `${appOutDir}/YourApp.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  });
};
