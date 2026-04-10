/**
 * Dialog service abstraction — decouples handler modules from Electron dialog API.
 * Allows framework-agnostic handler code while keeping Electron implementation details isolated.
 */
import type {
  SaveDialogOptions,
  SaveDialogReturnValue,
  OpenDialogOptions,
  OpenDialogReturnValue
} from 'electron'

export interface DialogService {
  showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogReturnValue>
  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue>
}

/**
 * Electron implementation of DialogService.
 * Used in production — injects real Electron dialog.
 */
export function createElectronDialogService(): DialogService {
  // Dynamic import to keep dialog coupling isolated to this factory
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dialog } = require('electron')

  return {
    showSaveDialog: (options: SaveDialogOptions) => dialog.showSaveDialog(options),
    showOpenDialog: (options: OpenDialogOptions) => dialog.showOpenDialog(options)
  }
}
