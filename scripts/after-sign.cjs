// electron-builder afterSign hook — notarizes the signed .app with Apple.
// Credentials are stored in Keychain under the profile "FLEET-notarize"
// (set up via: xcrun notarytool store-credentials "FLEET-notarize" ...)
//
// Skips notarization when:
//   - CSC_IDENTITY_AUTO_DISCOVERY=false (CI without signing)
//   - No FLEET_NOTARIZE env var set to "1" (opt-in for local builds)
//   - Running on non-macOS

const { notarize } = require('@electron/notarize')
const path = require('node:path')
const { existsSync } = require('node:fs')

function resolveAppPath(context) {
  const fromContext =
    context?.appOutDir && context?.packager?.appInfo?.productFilename
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
      : null
  if (fromContext && existsSync(fromContext)) return fromContext
  return null
}

module.exports = async function afterSign(context) {
  const { electronPlatformName } = context
  if (electronPlatformName !== 'darwin') return

  if (process.env.FLEET_NOTARIZE !== '1') {
    console.log('[after-sign] Skipping notarization (set FLEET_NOTARIZE=1 to enable)')
    return
  }

  const appPath = resolveAppPath(context)
  if (!appPath) {
    console.warn('[after-sign] No built .app found — skipping notarization')
    return
  }

  console.log(`[after-sign] Notarizing ${appPath} ...`)
  await notarize({
    tool: 'notarytool',
    appPath,
    keychainProfile: 'FLEET-notarize'
  })
  console.log('[after-sign] Notarization complete')
}
