// electron-builder afterSign hook — notarizes the signed .app with Apple.
//
// Local builds: credentials stored in Keychain under profile "FLEET-notarize"
//   (set up via: xcrun notarytool store-credentials "FLEET-notarize" ...)
//
// CI builds: credentials passed via env vars:
//   APPLE_API_KEY     — path to AuthKey_<id>.p8 file
//   APPLE_API_KEY_ID  — key ID (e.g. 84355R2S7M)
//   APPLE_API_ISSUER  — issuer UUID
//
// Skips notarization when FLEET_NOTARIZE is not "1" or platform is not macOS.

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

  const { APPLE_API_KEY_ID, APPLE_API_ISSUER, APPLE_API_KEY } = process.env

  if (APPLE_API_KEY_ID && APPLE_API_ISSUER && APPLE_API_KEY) {
    // CI: use env var credentials directly
    await notarize({
      tool: 'notarytool',
      appPath,
      appleApiKey: APPLE_API_KEY,
      appleApiKeyId: APPLE_API_KEY_ID,
      appleApiIssuer: APPLE_API_ISSUER
    })
  } else {
    // Local: use keychain profile stored by xcrun notarytool store-credentials
    await notarize({
      tool: 'notarytool',
      appPath,
      keychainProfile: 'FLEET-notarize'
    })
  }

  console.log('[after-sign] Notarization complete')
}
