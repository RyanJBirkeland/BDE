import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { dialog, app } from 'electron'

interface GatewayConfig {
  url: string
  token: string
}

export function getGitHubToken(): string | null {
  const configPath = join(homedir(), '.openclaw', 'openclaw.json')
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw)
    return config.githubToken ?? process.env['GITHUB_TOKEN'] ?? null
  } catch {
    return process.env['GITHUB_TOKEN'] ?? null
  }
}

export function saveGatewayConfig(url: string, token: string): void {
  const configPath = join(homedir(), '.openclaw', 'openclaw.json')

  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch {
    // start fresh if file missing or corrupt
  }

  config.gatewayUrl = url
  config.gatewayToken = token
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

export function getGatewayConfig(): GatewayConfig {
  const configPath = join(homedir(), '.openclaw', 'openclaw.json')

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw)

    const token = config.gatewayToken ?? config.gateway?.auth?.token
    const url = config.gatewayUrl ?? `ws://127.0.0.1:${config.gateway?.port ?? 18789}`

    if (!token) {
      dialog.showErrorBox(
        'BDE — Missing Gateway Token',
        'No gatewayToken found in ~/.openclaw/openclaw.json.\nPlease run `openclaw onboard` first.'
      )
      app.quit()
      throw new Error('Missing gatewayToken')
    }

    return { url, token }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      dialog.showErrorBox(
        'BDE — Config Not Found',
        'Could not find ~/.openclaw/openclaw.json.\nPlease install and configure OpenClaw first.'
      )
      app.quit()
    }
    throw err
  }
}
