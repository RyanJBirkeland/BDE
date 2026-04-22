import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createLogger } from '../logger'
import type { Logger } from '../logger'
import type { BdePlugin } from '../../shared/plugin-types'

const defaultLogger = createLogger('plugin-loader')
const DEFAULT_PLUGINS_DIR = join(homedir(), '.bde', 'plugins')

/**
 * Encapsulates the in-process plugin registry. Replaces the previous
 * module-level `loadedPlugins` array so the lifetime is owned by the caller
 * (composition root constructs one; tests construct their own).
 */
export class PluginRegistry {
  private readonly logger: Logger
  private readonly pluginsDir: string
  private plugins: BdePlugin[] = []

  constructor(opts: { logger?: Logger; pluginsDir?: string } = {}) {
    this.logger = opts.logger ?? defaultLogger
    this.pluginsDir = opts.pluginsDir ?? DEFAULT_PLUGINS_DIR
  }

  load(): BdePlugin[] {
    if (!existsSync(this.pluginsDir)) {
      this.logger.info(`[plugin-loader] No plugins directory at ${this.pluginsDir}`)
      this.plugins = []
      return this.plugins
    }
    const files = readdirSync(this.pluginsDir).filter(
      (f) => f.endsWith('.js') || f.endsWith('.cjs')
    )
    this.plugins = []
    for (const file of files) {
      const plugin = this.tryLoadPluginFile(file)
      if (plugin) this.plugins.push(plugin)
    }
    return this.plugins
  }

  list(): BdePlugin[] {
    return this.plugins
  }

  async emit<K extends keyof BdePlugin>(
    event: K,
    data: BdePlugin[K] extends (arg: infer A) => unknown ? A : never
  ): Promise<void> {
    for (const plugin of this.plugins) {
      const handler = plugin[event]
      if (typeof handler !== 'function') continue
      try {
        await (handler as (arg: unknown) => unknown)(data)
      } catch (err) {
        this.logger.error(`[plugin-loader] Plugin ${plugin.name}.${String(event)} error: ${err}`)
      }
    }
  }

  private tryLoadPluginFile(file: string): BdePlugin | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(join(this.pluginsDir, file))
      const plugin: BdePlugin = mod.default ?? mod
      if (!plugin.name) {
        this.logger.warn(`[plugin-loader] Skipping ${file} — missing 'name' export`)
        return null
      }
      this.logger.info(`[plugin-loader] Loaded plugin: ${plugin.name}`)
      return plugin
    } catch (err) {
      this.logger.error(`[plugin-loader] Failed to load ${file}: ${err}`)
      return null
    }
  }
}

// Default registry preserved for callers that have not migrated to DI yet.
const defaultRegistry = new PluginRegistry()

export function loadPlugins(): BdePlugin[] {
  return defaultRegistry.load()
}

export function getPlugins(): BdePlugin[] {
  return defaultRegistry.list()
}

export async function emitPluginEvent<K extends keyof BdePlugin>(
  event: K,
  data: BdePlugin[K] extends (arg: infer A) => unknown ? A : never
): Promise<void> {
  return defaultRegistry.emit(event, data)
}
