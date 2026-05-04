export interface UpdateChannels {
  /** Trigger an immediate update check from the renderer. */
  'updates:checkForUpdates': {
    args: []
    result: void
  }
  /** Quit the app and install the downloaded update. */
  'updates:install': {
    args: []
    result: void
  }
}
