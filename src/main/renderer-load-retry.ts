import type { BrowserWindow } from 'electron'
import { createLogger } from './logger'

const logger = createLogger('renderer-load-retry')

export const MAX_RENDERER_LOAD_RETRIES = 3
export const RENDERER_RETRY_BASE_DELAY_MS = 500
export const ERR_ABORTED = -3
export const READY_TO_SHOW_FALLBACK_MS = 3000

/**
 * Attaches retry logic to a BrowserWindow that automatically retries
 * renderer load failures up to MAX_RENDERER_LOAD_RETRIES times with
 * linear backoff.
 *
 * Ignores ERR_ABORTED (-3) and non-main-frame failures. Short-circuits
 * if the window is destroyed before retry fires.
 */
export function attachRendererLoadRetry(window: BrowserWindow): void {
  let attemptNumber = 0

  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // Ignore non-main-frame failures (iframes, subresources)
      if (!isMainFrame) {
        return
      }

      // ERR_ABORTED (-3) is a benign navigation cancel — no retry needed
      if (errorCode === ERR_ABORTED) {
        return
      }

      attemptNumber += 1

      if (attemptNumber > MAX_RENDERER_LOAD_RETRIES) {
        logger.warn(
          `Renderer load retry budget exhausted after ${MAX_RENDERER_LOAD_RETRIES} attempts. ` +
            `Last error: ${errorCode} (${errorDescription})`
        )
        return
      }

      const delayMs = RENDERER_RETRY_BASE_DELAY_MS * attemptNumber

      logger.warn(
        `Renderer failed to load (attempt ${attemptNumber}/${MAX_RENDERER_LOAD_RETRIES}): ` +
          `${errorCode} (${errorDescription}). Retrying in ${delayMs}ms...`
      )

      setTimeout(() => {
        if (window.isDestroyed()) {
          return
        }
        window.loadURL(validatedURL).catch((err) => {
          logger.error(`Retry loadURL failed: ${err}`)
        })
      }, delayMs)
    }
  )
}
