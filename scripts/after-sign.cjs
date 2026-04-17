// electron-builder afterSign hook — ad-hoc re-signs the bundle to normalize the
// Team ID on macOS 26. Runs after electron-builder finishes its own signing step
// (which, with identity: null, produces a linker-signed adhoc signature that
// macOS may still warn about on first launch for certain binaries).
//
// Must be a JS module — electron-builder require()s this file. Runs synchronously
// per the hook contract; a non-zero exit from codesign fails the build.

const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

function resolveAppPath(context) {
  const fromContext =
    context?.appOutDir && context?.packager?.appInfo?.productFilename
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
      : null
  if (fromContext && existsSync(fromContext)) return fromContext
  const fallback = path.resolve(__dirname, '..', 'release', 'mac-arm64', 'BDE.app')
  return existsSync(fallback) ? fallback : null
}

module.exports = async function afterSign(context) {
  const appPath = resolveAppPath(context)
  if (!appPath) {
    console.warn('[after-sign] No built .app found — skipping ad-hoc re-sign')
    return
  }
  console.log(`[after-sign] Ad-hoc re-signing ${appPath}`)
  try {
    execFileSync('codesign', ['--deep', '--force', '--sign', '-', appPath], {
      stdio: 'inherit'
    })
  } catch (err) {
    console.warn(`[after-sign] codesign failed (continuing): ${err.message}`)
  }
}
