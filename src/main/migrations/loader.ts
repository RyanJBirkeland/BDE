import type Database from 'better-sqlite3'

export interface Migration {
  version: number
  description: string
  up: (db: Database.Database) => void
}

type MigrationModule = {
  version: number
  description: string
  up: (db: Database.Database) => void
}

/**
 * Vite resolves this glob at COMPILE time into a static map of imports.
 * That means every matching migration file is bundled into the main-process
 * output — no runtime `readdirSync` required.
 *
 * Why this matters: the previous implementation used `readdirSync(__dirname)`
 * with a `.ts` filter. Once electron-vite bundles the main process, `__dirname`
 * resolves to `out/main/` which contains only bundled `.js` files, so the
 * loader silently returned `[]`. Migrations written after the "extract
 * migrations to separate files" refactor (c56b070c) never ran in builds —
 * the bug was only caught when v046 added code that queried a table the
 * (missing) migration was supposed to create.
 *
 * `import.meta.glob` works in dev (electron-vite), prod (bundled), and in
 * vitest, because all three use Vite's transform pipeline.
 */
const migrationModules = import.meta.glob<MigrationModule>('./v*.ts', {
  eager: true
})

/**
 * Loads all migration files from the migrations directory.
 * Migration files must be named v###-*.ts where ### is the version number.
 */
export function loadMigrations(): Migration[] {
  const migrations: Migration[] = []

  for (const [filePath, mod] of Object.entries(migrationModules)) {
    // Skip co-located test files that may match the glob (e.g. v046-*.test.ts).
    if (filePath.includes('.test.')) continue

    if (typeof mod.version !== 'number') {
      throw new Error(`Migration ${filePath} missing version export`)
    }
    if (typeof mod.description !== 'string') {
      throw new Error(`Migration ${filePath} missing description export`)
    }
    if (typeof mod.up !== 'function') {
      throw new Error(`Migration ${filePath} missing up function export`)
    }

    migrations.push({
      version: mod.version,
      description: mod.description,
      up: mod.up
    })
  }

  // Sort by version to ensure correct order
  migrations.sort((a, b) => a.version - b.version)

  // Validate version sequence: must be contiguous 1..N
  for (let i = 0; i < migrations.length; i++) {
    const expected = i + 1
    if (migrations[i].version !== expected) {
      throw new Error(
        `Migration version mismatch: expected v${expected}, found v${migrations[i].version}`
      )
    }
  }

  // Defense-in-depth: a silent 0-migration loader was our actual production
  // regression — throw loudly so a broken glob fails at startup, not later
  // at the first SQL query against a missing table.
  if (migrations.length === 0) {
    throw new Error(
      'loadMigrations() found 0 migrations matching "./v*.ts" — likely a ' +
        'bundler/glob regression. Verify import.meta.glob is being transformed ' +
        'at build time and that v###-*.ts files exist in src/main/migrations/.'
    )
  }

  return migrations
}
