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

export type AggregationMetric = 'count' | 'sum' | 'avg' | 'min' | 'max'

export interface DocumentAggregationRequest {
  connectionId: string
  index: string
  queryText?: string
  groupField?: string
  groupFields?: string[]
  metric: AggregationMetric
  metricField?: string
  size?: number
}

export interface DocumentAggregationBucket {
  keys: Array<string | number | boolean | null>
  key: string | number | boolean | null
  count: number
  value?: number | null
}

export interface DocumentAggregationResult {
  buckets: DocumentAggregationBucket[]
  total: number
  took?: number
  metric: AggregationMetric
  groupFields: string[]
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

export interface DocumentImportItem {
  id?: string
  index?: string
  document: Record<string, unknown>
}

export interface DocumentImportRequest {
  connectionId: string
  index: string
  documents?: DocumentImportItem[]
  content?: string
  mode?: 'existing' | 'create'
  targetIndex?: string
  refresh?: boolean
  operationId?: string
}

export interface DocumentImportResult {
  imported: number
  failed: number
  targetIndices: string[]
  overwritten: number
  created: number
  mode: 'upsert'
  targetMode: 'existing' | 'create'
  indexCreated: boolean
  errors: Array<{
    id?: string
    index?: string
    message: string
  }>
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

export interface JsonFileOpenResult {
  canceled: boolean
  filePath?: string
  content?: string
}

export interface JsonFileSaveRequest {
  defaultFileName: string
  content: string
}

export interface JsonFileSaveResult {
  canceled: boolean
  filePath?: string
}

export interface DocumentExportRequest {
  connectionId: string
  index: string
  queryText?: string
  operationId?: string
}

export interface DocumentExportPayload {
  index: string
  exportedAt: string
  total: number
  exported: number
  truncated?: boolean
  from?: number
  size?: number
  mappings?: Record<string, unknown>
  documents: DocumentImportItem[]
}

export interface OperationProgress {
  operationId: string
  type: 'import' | 'export'
  phase: string
  current: number
  total?: number
  percent?: number
  message: string
}
