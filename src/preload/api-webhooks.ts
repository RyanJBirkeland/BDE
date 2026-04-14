import { typedInvoke } from './ipc-helpers'

export const webhooks = {
  list: () => typedInvoke('webhook:list'),
  create: (payload: { url: string; events: string[]; secret?: string }) =>
    typedInvoke('webhook:create', payload),
  update: (payload: {
    id: string
    url?: string
    events?: string[]
    secret?: string | null
    enabled?: boolean
  }) => typedInvoke('webhook:update', payload),
  delete: (payload: { id: string }) => typedInvoke('webhook:delete', payload),
  test: (payload: { id: string }) => typedInvoke('webhook:test', payload)
}
