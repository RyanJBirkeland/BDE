import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      getGatewayConfig: () => Promise<{ url: string; token: string }>
    }
  }
}
