import { expect } from 'vitest'

/**
 * Assert that the mocked `safeHandle` (or any registration function with the
 * shape `(channel: string, handler: Function, ...optional)`) recorded exactly
 * the given set of channel names.
 *
 * Key property: **tolerant to additional positional args** after the handler.
 * The original test-suite pattern was
 *
 *   expect(safeHandle).toHaveBeenCalledWith('channel', expect.any(Function))
 *
 * which encoded "exactly two args" as a structural expectation. When `T-7`
 * began passing optional `parseArgs` validators as a third positional arg,
 * every test that used the literal-arg pattern broke without a meaningful
 * error message — the failure said "no matching call" rather than "you added
 * a validator." This helper checks the channel + handler-shape contract
 * without freezing the arity.
 *
 * Strict in two directions:
 *   - every expected channel must be present (extras are not silently allowed)
 *   - the registered handler at slot 1 must be a function
 */
export function assertHandlersRegistered(
  registrationMock: { mock: { calls: unknown[][] } },
  expectedChannels: readonly string[]
): void {
  const registeredChannels = registrationMock.mock.calls.map((call) => call[0])
  expect(new Set(registeredChannels)).toEqual(new Set(expectedChannels))

  for (const channel of expectedChannels) {
    const call = registrationMock.mock.calls.find((c) => c[0] === channel)
    expect(call, `expected ${channel} to be registered`).toBeDefined()
    expect(typeof call?.[1], `${channel} handler must be a function`).toBe('function')
  }
}
