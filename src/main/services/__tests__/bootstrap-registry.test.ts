import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  registerBootstrapService,
  runBootstrap,
  runTeardown,
  getRegisteredServices,
  clearServices,
  type BootstrapService
} from '../bootstrap-registry'

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
})

describe('bootstrap-registry', () => {
  let mockLogger: ReturnType<typeof createMockLogger>

  beforeEach(() => {
    clearServices()
    mockLogger = createMockLogger()
  })

  afterEach(() => {
    clearServices()
  })

  describe('registerBootstrapService', () => {
    it('should register a service', () => {
      const service: BootstrapService = {
        name: 'test-service',
        setup: vi.fn()
      }

      registerBootstrapService(service)

      expect(getRegisteredServices()).toHaveLength(1)
      expect(getRegisteredServices()[0]).toBe(service)
    })

    it('should register multiple services in order', () => {
      const service1: BootstrapService = { name: 'service-1', setup: vi.fn() }
      const service2: BootstrapService = { name: 'service-2', setup: vi.fn() }

      registerBootstrapService(service1)
      registerBootstrapService(service2)

      const services = getRegisteredServices()
      expect(services).toHaveLength(2)
      expect(services[0].name).toBe('service-1')
      expect(services[1].name).toBe('service-2')
    })
  })

  describe('runBootstrap', () => {
    it('should run all registered services', async () => {
      const setup1 = vi.fn()
      const setup2 = vi.fn()

      registerBootstrapService({ name: 'service-1', setup: setup1 })
      registerBootstrapService({ name: 'service-2', setup: setup2 })

      await runBootstrap(mockLogger)

      expect(setup1).toHaveBeenCalledOnce()
      expect(setup2).toHaveBeenCalledOnce()
    })

    it('should log start and completion for each service', async () => {
      registerBootstrapService({ name: 'test-service', setup: vi.fn() })

      await runBootstrap(mockLogger)

      expect(mockLogger.info).toHaveBeenCalledWith('Starting bootstrap with 1 services')
      expect(mockLogger.info).toHaveBeenCalledWith('[test-service] Starting...')
      expect(mockLogger.info).toHaveBeenCalledWith('[test-service] OK')
      expect(mockLogger.info).toHaveBeenCalledWith('Bootstrap complete')
    })

    it('should continue running services even if one fails', async () => {
      const setup1 = vi.fn()
      const setup2 = vi.fn(() => {
        throw new Error('Service 2 failed')
      })
      const setup3 = vi.fn()

      registerBootstrapService({ name: 'service-1', setup: setup1 })
      registerBootstrapService({ name: 'service-2', setup: setup2 })
      registerBootstrapService({ name: 'service-3', setup: setup3 })

      await runBootstrap(mockLogger)

      // All services should be called despite service-2 failing
      expect(setup1).toHaveBeenCalledOnce()
      expect(setup2).toHaveBeenCalledOnce()
      expect(setup3).toHaveBeenCalledOnce()
    })

    it('should log errors for failed services', async () => {
      const error = new Error('Setup failed')
      registerBootstrapService({
        name: 'failing-service',
        setup: () => {
          throw error
        }
      })

      await runBootstrap(mockLogger)

      expect(mockLogger.error).toHaveBeenCalledWith('[failing-service] Failed: Setup failed')
    })

    it('should handle async setup functions', async () => {
      const asyncSetup = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })

      registerBootstrapService({ name: 'async-service', setup: asyncSetup })

      await runBootstrap(mockLogger)

      expect(asyncSetup).toHaveBeenCalledOnce()
      expect(mockLogger.info).toHaveBeenCalledWith('[async-service] OK')
    })

    it('should handle services with no registered services', async () => {
      await runBootstrap(mockLogger)

      expect(mockLogger.info).toHaveBeenCalledWith('Starting bootstrap with 0 services')
      expect(mockLogger.info).toHaveBeenCalledWith('Bootstrap complete')
    })
  })

  describe('runTeardown', () => {
    it('should call teardown for services that have it', async () => {
      const teardown1 = vi.fn()
      const teardown2 = vi.fn()

      registerBootstrapService({
        name: 'service-1',
        setup: vi.fn(),
        teardown: teardown1
      })
      registerBootstrapService({
        name: 'service-2',
        setup: vi.fn(),
        teardown: teardown2
      })

      await runTeardown(mockLogger)

      expect(teardown1).toHaveBeenCalledOnce()
      expect(teardown2).toHaveBeenCalledOnce()
    })

    it('should skip services without teardown', async () => {
      const teardown = vi.fn()

      registerBootstrapService({ name: 'no-teardown', setup: vi.fn() })
      registerBootstrapService({
        name: 'with-teardown',
        setup: vi.fn(),
        teardown
      })

      await runTeardown(mockLogger)

      expect(teardown).toHaveBeenCalledOnce()
      expect(mockLogger.info).toHaveBeenCalledWith('[with-teardown] Teardown OK')
    })

    it('should log teardown errors but continue', async () => {
      const error = new Error('Teardown failed')
      const teardown1 = vi.fn(() => {
        throw error
      })
      const teardown2 = vi.fn()

      registerBootstrapService({
        name: 'failing-teardown',
        setup: vi.fn(),
        teardown: teardown1
      })
      registerBootstrapService({
        name: 'successful-teardown',
        setup: vi.fn(),
        teardown: teardown2
      })

      await runTeardown(mockLogger)

      expect(teardown1).toHaveBeenCalledOnce()
      expect(teardown2).toHaveBeenCalledOnce()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[failing-teardown] Teardown failed: Teardown failed'
      )
    })
  })

  describe('clearServices', () => {
    it('should remove all registered services', () => {
      registerBootstrapService({ name: 'service-1', setup: vi.fn() })
      registerBootstrapService({ name: 'service-2', setup: vi.fn() })

      expect(getRegisteredServices()).toHaveLength(2)

      clearServices()

      expect(getRegisteredServices()).toHaveLength(0)
    })
  })
})
