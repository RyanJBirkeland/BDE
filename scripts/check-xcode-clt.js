#!/usr/bin/env node
/**
 * Preflight check for Xcode Command Line Tools.
 * Runs before electron-rebuild in postinstall so the error message is actionable.
 *
 * electron-rebuild shells to node-gyp, which requires a C++ compiler.
 * On a fresh macOS machine without Xcode CLT, npm install fails with an opaque
 * gyp error. This script detects the missing toolchain early and prints a clear fix.
 */
import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin') {
  // Only macOS requires Xcode CLT — Linux/Windows have their own toolchains
  process.exit(0)
}

const result = spawnSync('cc', ['--version'], { encoding: 'utf8', stdio: 'pipe' })

if (result.status !== 0 || result.error) {
  process.stderr.write(
    '\n' +
    '╔══════════════════════════════════════════════════════════════╗\n' +
    '║  Xcode Command Line Tools required                          ║\n' +
    '║                                                              ║\n' +
    '║  BDE requires a C++ compiler to build better-sqlite3.        ║\n' +
    '║  Install the Xcode CLT, then re-run npm install:             ║\n' +
    '║                                                              ║\n' +
    '║    xcode-select --install                                    ║\n' +
    '║                                                              ║\n' +
    '║  After installation completes, run: npm install              ║\n' +
    '╚══════════════════════════════════════════════════════════════╝\n' +
    '\n'
  )
  process.exit(1)
}
