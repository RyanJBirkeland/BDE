export async function getSetting(key: string): Promise<string | null> {
  return window.api.settings.get(key)
}

export async function setSetting(key: string, value: string): Promise<void> {
  return window.api.settings.set(key, value)
}

export async function getJsonSetting<T = unknown>(key: string): Promise<T | null> {
  return window.api.settings.getJson(key) as Promise<T | null>
}

export async function setJsonSetting<T>(key: string, value: T): Promise<void> {
  return window.api.settings.setJson(key, value)
}
