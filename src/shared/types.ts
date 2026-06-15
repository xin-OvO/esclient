export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } }

export type AuthType = 'none' | 'basic' | 'apiKey'

export interface ConnectionInput {
  name: string
  node: string
  authType: AuthType
  username?: string
  password?: string
  apiKey?: string
  rejectUnauthorized: boolean
}

export interface ConnectionProfile {
  id: string
  name: string
  node: string
  authType: AuthType
  username?: string
  rejectUnauthorized: boolean
  createdAt: string
  updatedAt: string
  hasSecret: boolean
}

export interface ConnectionInfo {
  connection: ConnectionProfile
  clusterName?: string
  clusterUuid?: string
  version?: string
  tagline?: string
}

export interface ClusterHealth {
  cluster_name?: string
  status?: string
  number_of_nodes?: number
  active_primary_shards?: number
  active_shards?: number
  relocating_shards?: number
  initializing_shards?: number
  unassigned_shards?: number
  [key: string]: unknown
}

export interface IndexSummary {
  health?: string
  status?: string
  index: string
  uuid?: string
  pri?: string
  rep?: string
  docsCount?: string
  docsDeleted?: string
  storeSize?: string
  priStoreSize?: string
}

export interface TemplateSummary {
  name: string
  type: 'index_template' | 'legacy_template'
  indexPatterns?: string[]
  priority?: number
  version?: number
}

export interface DocumentRow {
  _id: string
  _index: string
  _score?: number | null
  _source: Record<string, unknown>
}

export interface DocumentSearchRequest {
  connectionId: string
  index: string
  queryText?: string
  size?: number
  from?: number
}

export interface DocumentSearchResult {
  rows: DocumentRow[]
  total: number
  took?: number
}

export interface DocumentWriteRequest {
  connectionId: string
  index: string
  id: string
  document: Record<string, unknown>
  refresh?: boolean
}

export interface DocumentUpdateRequest {
  connectionId: string
  index: string
  id: string
  doc: Record<string, unknown>
  refresh?: boolean
}

export interface IndexCreateRequest {
  connectionId: string
  index: string
  body?: Record<string, unknown>
}

export interface IndexDeleteRequest {
  connectionId: string
  index: string
}

export interface TemplatePutRequest {
  connectionId: string
  name: string
  type: 'index_template' | 'legacy_template'
  body: Record<string, unknown>
}

export interface TemplateDeleteRequest {
  connectionId: string
  name: string
  type: 'index_template' | 'legacy_template'
}

export interface MappingUpdateRequest {
  connectionId: string
  index: string
  body: Record<string, unknown>
}
