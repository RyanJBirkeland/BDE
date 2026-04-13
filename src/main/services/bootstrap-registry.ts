/**
 * Bootstrap service registry — allows background services to register setup/teardown handlers
 * for graceful degradation at app startup. If one service fails, others still initialize.
 */
import type { Logger } from '../logger'
import { getErrorMessage } from '../../shared/errors'

export interface BootstrapService {
  name: string
  setup(): Promise<void> | void
  teardown?(): Promise<void> | void
}

const services: BootstrapService[] = []

/**
 * Register a background service to run at bootstrap.
 */
export function registerBootstrapService(service: BootstrapService): void {
  services.push(service)
}

/**
 * Run all registered bootstrap services with graceful error handling.
 * Each service runs in isolation — failures are logged but don't crash the app.
 */
export async function runBootstrap(logger: Logger): Promise<void> {
  logger.info(`Starting bootstrap with ${services.length} services`)

  for (const service of services) {
    try {
      logger.info(`[${service.name}] Starting...`)
      await service.setup()
      logger.info(`[${service.name}] OK`)
    } catch (err) {
      logger.error(`[${service.name}] Failed: ${getErrorMessage(err)}`)
      // Continue with remaining services — this is graceful degradation
    }
  }

  logger.info('Bootstrap complete')
}

/**
 * Run teardown for all registered services (called on app quit).
 */
export async function runTeardown(logger: Logger): Promise<void> {
  logger.info('Running bootstrap teardown')

  for (const service of services) {
    if (service.teardown) {
      try {
        await service.teardown()
        logger.info(`[${service.name}] Teardown OK`)
      } catch (err) {
        logger.warn(`[${service.name}] Teardown failed: ${getErrorMessage(err)}`)
      }
    }
  }
}

/**
 * Get all registered services (for testing).
 */
export function getRegisteredServices(): ReadonlyArray<BootstrapService> {
  return services
}

/**
 * Clear all registered services (for testing).
 */
export function clearServices(): void {
  services.length = 0
}
