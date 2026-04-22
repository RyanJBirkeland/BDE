/**
 * Webhook configuration shape — shared between the data layer (which reads
 * `webhooks` rows) and the service layer (which delivers HTTP POSTs).
 *
 * Lives in `shared/types/` so the data layer no longer reaches up into
 * services/ for the type — that import direction was the audit's complaint.
 */
export interface WebhookConfig {
  id: string
  url: string
  events: string[]
  secret: string | null
  enabled: boolean
}
