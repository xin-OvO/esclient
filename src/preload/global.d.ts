import type { esClientApi } from './index'

declare global {
  interface Window {
    esClient: typeof esClientApi
  }
}
