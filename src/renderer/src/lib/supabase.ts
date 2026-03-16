export interface SupabaseConfig {
  url: string
  anonKey: string
}

export async function getSupabaseConfig(): Promise<SupabaseConfig | null> {
  return window.api.getSupabaseConfig()
}
