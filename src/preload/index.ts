import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApiResult,
  ClusterHealth,
  ConnectionInfo,
  ConnectionInput,
  ConnectionProfile,
  DocumentSearchRequest,
  DocumentSearchResult,
  DocumentUpdateRequest,
  DocumentWriteRequest,
  IndexCreateRequest,
  IndexDeleteRequest,
  IndexSummary,
  MappingUpdateRequest,
  TemplateDeleteRequest,
  TemplatePutRequest,
  TemplateSummary
} from '../shared/types'

const invoke = <T>(channel: string, payload?: unknown): Promise<ApiResult<T>> => {
  return ipcRenderer.invoke(channel, payload)
}

export const esClientApi = {
  connections: {
    list: (): Promise<ApiResult<ConnectionProfile[]>> => invoke('connections:list'),
    save: (payload: ConnectionInput & { id?: string }): Promise<ApiResult<ConnectionProfile>> =>
      invoke('connections:save', payload),
    remove: (id: string): Promise<ApiResult<void>> => invoke('connections:remove', id),
    test: (payload: ConnectionInput): Promise<ApiResult<ConnectionInfo>> => invoke('connections:test', payload),
    info: (id: string): Promise<ApiResult<ConnectionInfo>> => invoke('connections:info', id)
  },
  cluster: {
    health: (connectionId: string): Promise<ApiResult<ClusterHealth>> =>
      invoke('cluster:health', connectionId),
    settings: (connectionId: string): Promise<ApiResult<Record<string, unknown>>> =>
      invoke('cluster:settings', connectionId)
  },
  indices: {
    list: (connectionId: string): Promise<ApiResult<IndexSummary[]>> => invoke('indices:list', connectionId),
    create: (payload: IndexCreateRequest): Promise<ApiResult<void>> => invoke('indices:create', payload),
    delete: (payload: IndexDeleteRequest): Promise<ApiResult<void>> => invoke('indices:delete', payload),
    mapping: (payload: { connectionId: string; index: string }): Promise<ApiResult<Record<string, unknown>>> =>
      invoke('indices:mapping', payload),
    putMapping: (payload: MappingUpdateRequest): Promise<ApiResult<void>> =>
      invoke('indices:putMapping', payload)
  },
  templates: {
    list: (connectionId: string): Promise<ApiResult<TemplateSummary[]>> =>
      invoke('templates:list', connectionId),
    get: (payload: {
      connectionId: string
      name: string
      type: 'index_template' | 'legacy_template'
    }): Promise<ApiResult<Record<string, unknown>>> => invoke('templates:get', payload),
    put: (payload: TemplatePutRequest): Promise<ApiResult<void>> => invoke('templates:put', payload),
    delete: (payload: TemplateDeleteRequest): Promise<ApiResult<void>> => invoke('templates:delete', payload)
  },
  documents: {
    search: (payload: DocumentSearchRequest): Promise<ApiResult<DocumentSearchResult>> =>
      invoke('documents:search', payload),
    create: (payload: DocumentWriteRequest): Promise<ApiResult<void>> => invoke('documents:create', payload),
    update: (payload: DocumentUpdateRequest): Promise<ApiResult<void>> => invoke('documents:update', payload),
    delete: (payload: { connectionId: string; index: string; id: string; refresh?: boolean }): Promise<ApiResult<void>> =>
      invoke('documents:delete', payload)
  }
}

contextBridge.exposeInMainWorld('esClient', esClientApi)
