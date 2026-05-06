export async function getSetting(key: string): Promise<string | null> {
  return window.api.settings.get(key)
}

export async function setSetting(key: string, value: string): Promise<void> {
  return window.api.settings.set(key, value)
}

/**
 * Reads a JSON setting and validates the parsed shape with the provided guard.
 * Returns null if the key is unset or if the stored payload fails validation
 * (a corrupted setting should never crash the renderer — log and fall back).
 */
export async function getJsonSetting<T>(
  key: string,
  validate: (raw: unknown) => raw is T
): Promise<T | null> {
  const raw = await window.api.settings.getJson(key)
  if (raw === null || raw === undefined) return null
  if (!validate(raw)) {
    console.warn(`getJsonSetting("${key}"): stored value failed validation, returning null`)
    return null
  }
  return raw
}

export async function setJsonSetting<T>(key: string, value: T): Promise<void> {
  return window.api.settings.setJson(key, value)
}
