import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import Store from 'electron-store'
import { Client } from '@elastic/elasticsearch'
import type {
  ApiResult,
  ClusterHealth,
  ConnectionInfo,
  ConnectionInput,
  ConnectionProfile,
  DocumentAggregationRequest,
  DocumentAggregationResult,
  DocumentExportRequest,
  DocumentExportPayload,
  DocumentImportItem,
  DocumentImportRequest,
  DocumentImportResult,
  DocumentRow,
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
import { parseSearchBody } from '../shared/query'

interface StoredConnection extends Omit<ConnectionProfile, 'hasSecret'> {
  secret?: string
}

interface StoreShape {
  connections: StoredConnection[]
}

const store = new Store<StoreShape>({
  defaults: {
    connections: []
  }
})

const clients = new Map<string, Client>()
const currentDir = fileURLToPath(new URL('.', import.meta.url))
const DEFAULT_SEARCH_SIZE = 50
const DEFAULT_RESULT_WINDOW = 10000
const DEEP_PAGE_BATCH_SIZE = 500
const MAX_EXPORT_DOCUMENTS = 100000
const IMPORT_PROGRESS_BATCH_SIZE = 50

interface ParsedImportFile {
  index?: string
  mappings?: Record<string, unknown>
  documents: DocumentImportItem[]
}

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data })

const safeDetails = (value: unknown): unknown => {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

const fail = (error: unknown): ApiResult<never> => {
  const maybeError = error as {
    name?: string
    message?: string
    meta?: unknown
    code?: string
  }
  const meta = maybeError.meta as
    | {
        body?: {
          error?:
            | string
            | {
                reason?: string
                type?: string
                root_cause?: Array<{ reason?: string; type?: string }>
                caused_by?: { reason?: string; type?: string }
              }
        }
      }
    | undefined
  const bodyError = meta?.body?.error
  const elasticReason =
    typeof bodyError === 'object'
      ? bodyError.reason ||
        bodyError.caused_by?.reason ||
        bodyError.root_cause?.find((item) => item.reason)?.reason ||
        bodyError.type
      : typeof bodyError === 'string'
        ? bodyError
        : undefined

  return {
    ok: false,
    error: {
      code: maybeError.code || maybeError.name || 'Error',
      message: elasticReason || maybeError.message || '操作失败',
      details: safeDetails(maybeError.meta || error)
    }
  }
}

const emitProgress = (
  sender: Electron.WebContents,
  progress: {
    operationId?: string
    type: 'import' | 'export'
    phase: string
    current: number
    total?: number
    message: string
  }
): void => {
  if (!progress.operationId) {
    return
  }

  sender.send('operation:progress', {
    ...progress,
    operationId: progress.operationId,
    percent:
      typeof progress.total === 'number' && progress.total > 0
        ? Math.min(100, Math.round((progress.current / progress.total) * 100))
        : undefined
  })
}

const publicConnection = (connection: StoredConnection): ConnectionProfile => ({
  id: connection.id,
  name: connection.name,
  node: connection.node,
  authType: connection.authType,
  username: connection.username,
  rejectUnauthorized: connection.rejectUnauthorized,
  createdAt: connection.createdAt,
  updatedAt: connection.updatedAt,
  hasSecret: Boolean(connection.secret)
})

const encryptSecret = (secret: string): string => {
  if (!secret) {
    return ''
  }

  if (safeStorage.isEncryptionAvailable()) {
    return `safe:${safeStorage.encryptString(secret).toString('base64')}`
  }

  return `plain:${Buffer.from(secret, 'utf8').toString('base64')}`
}

const decryptSecret = (secret?: string): string | undefined => {
  if (!secret) {
    return undefined
  }

  if (secret.startsWith('safe:')) {
    return safeStorage.decryptString(Buffer.from(secret.slice(5), 'base64'))
  }

  if (secret.startsWith('plain:')) {
    return Buffer.from(secret.slice(6), 'base64').toString('utf8')
  }

  return undefined
}

const normalizeConnectionInput = (
  payload: ConnectionInput & { id?: string },
  existing?: StoredConnection
): StoredConnection => {
  const now = new Date().toISOString()
  const rawSecret = payload.authType === 'apiKey' ? payload.apiKey : payload.password
  const shouldReuseSecret = rawSecret === undefined && existing?.secret

  return {
    id: payload.id || existing?.id || randomUUID(),
    name: payload.name.trim(),
    node: payload.node.trim(),
    authType: payload.authType,
    username: payload.authType === 'basic' ? payload.username?.trim() : undefined,
    rejectUnauthorized: payload.rejectUnauthorized,
    secret: shouldReuseSecret ? existing.secret : rawSecret ? encryptSecret(rawSecret) : undefined,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }
}

const validateConnectionInput = (payload: ConnectionInput): void => {
  if (!payload.name?.trim()) {
    throw new Error('请输入连接名称')
  }

  if (!payload.node?.trim()) {
    throw new Error('请输入 Elasticsearch 地址')
  }

  try {
    new URL(payload.node)
  } catch {
    throw new Error('Elasticsearch 地址格式不正确')
  }

  if (payload.authType === 'basic' && !payload.username?.trim()) {
    throw new Error('Basic Auth 需要填写用户名')
  }
}

const createClientFromStored = (connection: StoredConnection): Client => {
  const secret = decryptSecret(connection.secret)
  const auth =
    connection.authType === 'basic'
      ? { username: connection.username || '', password: secret || '' }
      : connection.authType === 'apiKey'
        ? { apiKey: secret || '' }
        : undefined

  return new Client({
    node: connection.node,
    auth,
    requestTimeout: 8000,
    pingTimeout: 8000,
    maxRetries: 0,
    tls: {
      rejectUnauthorized: connection.rejectUnauthorized
    }
  })
}

const createClientFromInput = (payload: ConnectionInput): Client => {
  const auth =
    payload.authType === 'basic'
      ? { username: payload.username || '', password: payload.password || '' }
      : payload.authType === 'apiKey'
        ? { apiKey: payload.apiKey || '' }
        : undefined

  return new Client({
    node: payload.node,
    auth,
    requestTimeout: 8000,
    pingTimeout: 8000,
    maxRetries: 0,
    tls: {
      rejectUnauthorized: payload.rejectUnauthorized
    }
  })
}

const getConnections = (): StoredConnection[] => store.get('connections') || []

const saveConnections = (connections: StoredConnection[]): void => {
  store.set('connections', connections)
}

const getStoredConnection = (id: string): StoredConnection => {
  const connection = getConnections().find((item) => item.id === id)

  if (!connection) {
    throw new Error('连接不存在')
  }

  return connection
}

const getClient = (id: string): Client => {
  const existing = clients.get(id)
  if (existing) {
    return existing
  }

  const client = createClientFromStored(getStoredConnection(id))
  clients.set(id, client)
  return client
}

const getConnectionInfo = async (client: Client, connection: StoredConnection): Promise<ConnectionInfo> => {
  const info = (await client.info()) as Record<string, unknown>
  const version = info.version as { number?: string } | undefined

  return {
    connection: publicConnection(connection),
    clusterName: info.cluster_name as string | undefined,
    clusterUuid: info.cluster_uuid as string | undefined,
    version: version?.number,
    tagline: info.tagline as string | undefined
  }
}

const flattenHit = (hit: Record<string, unknown>): DocumentRow => ({
  _id: String(hit._id),
  _index: String(hit._index),
  _score: typeof hit._score === 'number' ? hit._score : null,
  _source: ((hit._source || {}) as Record<string, unknown>) || {}
})

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const normalizeNumber = (value: number | undefined, fallback: number): number => {
  if (!Number.isFinite(value) || !value) {
    return fallback
  }

  return Math.max(1, Math.floor(value))
}

const extractTotal = (result: Record<string, unknown>): number => {
  const hitsRoot = result.hits as
    | {
        total?: number | { value?: number }
      }
    | undefined

  return typeof hitsRoot?.total === 'number'
    ? hitsRoot.total
    : typeof hitsRoot?.total?.value === 'number'
      ? hitsRoot.total.value
      : 0
}

const extractHits = (result: Record<string, unknown>): Array<Record<string, unknown>> => {
  const hitsRoot = result.hits as
    | {
        hits?: Array<Record<string, unknown>>
      }
    | undefined

  return hitsRoot?.hits || []
}

const getSortValues = (hit: Record<string, unknown>): unknown[] | undefined => {
  return Array.isArray(hit.sort) ? hit.sort : undefined
}

const normalizeSearchBody = (body: Record<string, unknown>): Record<string, unknown> => {
  const { from: _from, size: _size, search_after: _searchAfter, ...rest } = body
  return rest
}

interface AggregationBucketNode {
  key?: string | number | boolean | null
  doc_count?: number
  metric_value?: { value?: number | null }
  next?: {
    buckets?: AggregationBucketNode[]
  }
}

const normalizeGroupFields = (payload: DocumentAggregationRequest): string[] => {
  const fields = (payload.groupFields?.length ? payload.groupFields : payload.groupField ? [payload.groupField] : [])
    .map((field) => field.trim())
    .filter(Boolean)

  return Array.from(new Set(fields)).slice(0, 5)
}

const buildNestedTermsAggregation = (
  fields: string[],
  size: number,
  metricAgg: Record<string, unknown>
): Record<string, unknown> => {
  const buildLevel = (index: number): Record<string, unknown> => {
    const isLeaf = index === fields.length - 1
    return {
      terms: {
        field: fields[index],
        size
      },
      aggs: isLeaf ? metricAgg : { next: buildLevel(index + 1) }
    }
  }

  return buildLevel(0)
}

const flattenAggregationBuckets = (
  buckets: AggregationBucketNode[],
  groupDepth: number,
  parentKeys: Array<string | number | boolean | null> = []
): DocumentAggregationResult['buckets'] => {
  return buckets.flatMap((bucket) => {
    const key = bucket.key === '__MISSING__' ? null : (bucket.key ?? null)
    const keys = [...parentKeys, key]

    if (keys.length < groupDepth) {
      return flattenAggregationBuckets(bucket.next?.buckets || [], groupDepth, keys)
    }

    return [
      {
        keys,
        key: keys.join(' / '),
        count: bucket.doc_count || 0,
        value: bucket.metric_value?.value ?? undefined
      }
    ]
  })
}

const getDeepPageSort = (body: Record<string, unknown>): unknown => {
  return body.sort === undefined ? [{ _doc: 'asc' }] : body.sort
}

const searchDocuments = async (
  client: Client,
  payload: DocumentSearchRequest
): Promise<DocumentSearchResult> => {
  const requestedFrom = Math.max(0, Math.floor(payload.from || 0))
  const size = normalizeNumber(payload.size, DEFAULT_SEARCH_SIZE)
  const rawBody = parseSearchBody(payload.queryText)
  const body = normalizeSearchBody(rawBody)
  let took: number | undefined
  let rows: DocumentRow[] = []

  if (requestedFrom + size <= DEFAULT_RESULT_WINDOW) {
    const result = (await client.search({
      index: payload.index,
      from: requestedFrom,
      size,
      track_total_hits: true,
      body
    })) as Record<string, unknown>

    took = result.took as number | undefined
    rows = extractHits(result).map(flattenHit)
    return {
      rows,
      total: extractTotal(result),
      took
    }
  }

  const totalResult = (await client.search({
    index: payload.index,
    size: 0,
    track_total_hits: true,
    body
  })) as Record<string, unknown>
  const total = extractTotal(totalResult)

  if (requestedFrom >= total) {
    return { rows: [], total, took: 0 }
  }

  let remainingToSkip = requestedFrom
  let searchAfter: unknown[] | undefined
  let accumulatedTook = 0
  const deepSort = getDeepPageSort(body)

  while (remainingToSkip > 0) {
    const batchSize = Math.min(DEEP_PAGE_BATCH_SIZE, remainingToSkip)
    const result = (await client.search({
      index: payload.index,
      size: batchSize,
      track_total_hits: false,
      body: {
        ...body,
        sort: deepSort,
        ...(searchAfter ? { search_after: searchAfter } : {})
      }
    })) as Record<string, unknown>
    const hits = extractHits(result)
    accumulatedTook += (result.took as number | undefined) || 0

    if (!hits.length) {
      return { rows: [], total, took: accumulatedTook }
    }

    remainingToSkip -= hits.length
    searchAfter = getSortValues(hits[hits.length - 1])

    if (!searchAfter || hits.length < batchSize) {
      return { rows: [], total, took: accumulatedTook }
    }
  }

  const pageResult = (await client.search({
    index: payload.index,
    size,
    track_total_hits: false,
    body: {
      ...body,
      sort: deepSort,
      ...(searchAfter ? { search_after: searchAfter } : {})
    }
  })) as Record<string, unknown>

  accumulatedTook += (pageResult.took as number | undefined) || 0

  return {
    rows: extractHits(pageResult).map(flattenHit),
    total,
    took: accumulatedTook
  }
}

const aggregateDocuments = async (
  client: Client,
  payload: DocumentAggregationRequest
): Promise<DocumentAggregationResult> => {
  const groupFields = normalizeGroupFields(payload)

  if (!groupFields.length) {
    throw new Error('请选择分组字段')
  }

  if (payload.metric !== 'count' && !payload.metricField?.trim()) {
    throw new Error('请选择指标字段')
  }

  const size = Math.min(1000, Math.max(1, Math.floor(payload.size || 100)))
  const body = normalizeSearchBody(parseSearchBody(payload.queryText))
  const metricAgg =
    payload.metric === 'count'
      ? {}
      : {
          metric_value: {
            [payload.metric]: {
              field: payload.metricField
            }
          }
        }
  const groupsAgg = buildNestedTermsAggregation(groupFields, size, metricAgg)
  const result = (await client.search({
    index: payload.index,
    size: 0,
    track_total_hits: true,
    body: {
      ...body,
      aggs: {
        groups: groupsAgg
      }
    }
  })) as Record<string, unknown>
  const aggregations = result.aggregations as
    | {
        groups?: {
          buckets?: AggregationBucketNode[]
        }
      }
    | undefined

  return {
    buckets: flattenAggregationBuckets(aggregations?.groups?.buckets || [], groupFields.length),
    total: extractTotal(result),
    took: result.took as number | undefined,
    metric: payload.metric,
    groupFields
  }
}

const extractCreateIndexBody = (payload: ParsedImportFile, fallbackIndex: string): Record<string, unknown> | undefined => {
  const mappings = payload.mappings
  if (!isRecord(mappings)) {
    return undefined
  }

  const sourceIndex = payload.index || fallbackIndex
  const indexEntry = isRecord(mappings[sourceIndex])
    ? (mappings[sourceIndex] as Record<string, unknown>)
    : Object.values(mappings).find(isRecord)
  const rawMappings = isRecord(indexEntry?.mappings)
    ? (indexEntry.mappings as Record<string, unknown>)
    : isRecord(mappings.mappings)
      ? (mappings.mappings as Record<string, unknown>)
      : isRecord(mappings.properties)
        ? mappings
        : undefined

  if (!rawMappings) {
    return undefined
  }

  return {
    mappings: rawMappings
  }
}

const parseImportPayload = (content: string, fallbackIndex: string): ParsedImportFile => {
  const trimmed = content.trim()
  if (!trimmed) {
    throw new Error('导入文件为空')
  }

  const fromRecord = (record: Record<string, unknown>): DocumentImportItem => {
    const hasWrappedSource = isRecord(record._source) || isRecord(record.document) || isRecord(record.doc)
    const source = isRecord(record._source)
      ? record._source
      : isRecord(record.document)
        ? record.document
        : isRecord(record.doc)
          ? record.doc
          : record
    const body = source === record ? { ...record } : source

    if (source === record) {
      delete body._id
      delete body._index
    }

    if (!isRecord(body)) {
      throw new Error('导入文档必须是 JSON 对象')
    }

    return {
      id:
        typeof record._id === 'string'
          ? record._id
          : hasWrappedSource && typeof record.id === 'string'
            ? record.id
            : undefined,
      index:
        typeof record._index === 'string'
          ? record._index
          : hasWrappedSource && typeof record.index === 'string'
            ? record.index
            : fallbackIndex,
      document: body
    }
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) {
      return {
        documents: parsed.map((item) => {
          if (!isRecord(item)) {
            throw new Error('数组导入项必须是 JSON 对象')
          }
          return fromRecord(item)
        })
      }
    }

    if (isRecord(parsed)) {
      if (Array.isArray(parsed.documents)) {
        return {
          index: typeof parsed.index === 'string' ? parsed.index : undefined,
          mappings: isRecord(parsed.mappings) ? parsed.mappings : undefined,
          documents: parsed.documents.map((item) => {
            if (!isRecord(item)) {
              throw new Error('documents 数组导入项必须是 JSON 对象')
            }
            return fromRecord(item)
          })
        }
      }

      return {
        documents: [fromRecord(parsed)]
      }
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      // Fall through to JSONL / bulk style parsing.
    } else {
      throw error
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const imported: DocumentImportItem[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const parsed = JSON.parse(lines[index]) as unknown
    if (!isRecord(parsed)) {
      throw new Error(`第 ${index + 1} 行不是 JSON 对象`)
    }

    const meta = parsed.index || parsed.create
    if (isRecord(meta)) {
      const nextLine = lines[index + 1]
      if (!nextLine) {
        throw new Error(`第 ${index + 1} 行 bulk 元数据缺少文档内容`)
      }
      const document = JSON.parse(nextLine) as unknown
      if (!isRecord(document)) {
        throw new Error(`第 ${index + 2} 行不是 JSON 对象`)
      }
      imported.push({
        id: typeof meta._id === 'string' ? meta._id : undefined,
        index: typeof meta._index === 'string' ? meta._index : fallbackIndex,
        document
      })
      index += 1
    } else {
      imported.push(fromRecord(parsed))
    }
  }

  if (!imported.length) {
    throw new Error('未解析到可导入文档')
  }

  return {
    documents: imported
  }
}

const registerIpc = (): void => {
  ipcMain.handle('files:open-json', async () => {
    const window = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(window || undefined, {
      title: '导入 JSON 文档',
      properties: ['openFile'],
      filters: [
        { name: 'JSON 文档', extensions: ['json', 'jsonl', 'ndjson'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true }
    }

    return {
      canceled: false,
      filePath: result.filePaths[0],
      content: await readFile(result.filePaths[0], 'utf8')
    }
  })

  ipcMain.handle('files:save-json', async (_event, payload: { defaultFileName: string; content: string }) => {
    const window = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(window || undefined, {
      title: '导出 JSON 文档',
      defaultPath: payload.defaultFileName,
      filters: [
        { name: 'JSON 文档', extensions: ['json'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return { canceled: true }
    }

    await writeFile(result.filePath, payload.content, 'utf8')
    return {
      canceled: false,
      filePath: result.filePath
    }
  })

  ipcMain.handle('connections:list', async () => {
    try {
      return ok(getConnections().map(publicConnection))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('connections:save', async (_event, payload: ConnectionInput & { id?: string }) => {
    try {
      validateConnectionInput(payload)
      const connections = getConnections()
      const existing = payload.id ? connections.find((item) => item.id === payload.id) : undefined
      const saved = normalizeConnectionInput(payload, existing)
      const next = existing
        ? connections.map((item) => (item.id === saved.id ? saved : item))
        : [...connections, saved]

      saveConnections(next)
      clients.delete(saved.id)
      return ok(publicConnection(saved))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('connections:remove', async (_event, id: string) => {
    try {
      saveConnections(getConnections().filter((item) => item.id !== id))
      clients.delete(id)
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('connections:test', async (_event, payload: ConnectionInput) => {
    try {
      validateConnectionInput(payload)
      const client = createClientFromInput(payload)
      const tempConnection = normalizeConnectionInput(payload)
      const info = await getConnectionInfo(client, tempConnection)
      await client.close()
      return ok(info)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('connections:info', async (_event, id: string) => {
    try {
      return ok(await getConnectionInfo(getClient(id), getStoredConnection(id)))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('cluster:health', async (_event, connectionId: string) => {
    try {
      const health = (await getClient(connectionId).cluster.health()) as ClusterHealth
      return ok(health)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('cluster:settings', async (_event, connectionId: string) => {
    try {
      const settings = (await getClient(connectionId).cluster.getSettings({
        include_defaults: true
      })) as Record<string, unknown>
      return ok(settings)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('indices:list', async (_event, connectionId: string) => {
    try {
      const rows = (await getClient(connectionId).cat.indices({
        format: 'json',
        bytes: 'mb'
      })) as Array<Record<string, string>>

      const summaries: IndexSummary[] = rows
        .map((row) => ({
          health: row.health,
          status: row.status,
          index: row.index,
          uuid: row.uuid,
          pri: row.pri,
          rep: row.rep,
          docsCount: row['docs.count'],
          docsDeleted: row['docs.deleted'],
          storeSize: row['store.size'],
          priStoreSize: row['pri.store.size']
        }))
        .sort((a, b) => a.index.localeCompare(b.index))

      return ok(summaries)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('indices:create', async (_event, payload: IndexCreateRequest) => {
    try {
      await getClient(payload.connectionId).indices.create({
        index: payload.index,
        ...(payload.body ? { body: payload.body } : {})
      })
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('indices:delete', async (_event, payload: IndexDeleteRequest) => {
    try {
      await getClient(payload.connectionId).indices.delete({ index: payload.index })
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('indices:mapping', async (_event, payload: { connectionId: string; index: string }) => {
    try {
      const mapping = (await getClient(payload.connectionId).indices.getMapping({
        index: payload.index
      })) as Record<string, unknown>
      return ok(mapping)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('indices:putMapping', async (_event, payload: MappingUpdateRequest) => {
    try {
      await getClient(payload.connectionId).indices.putMapping({
        index: payload.index,
        body: payload.body
      })
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('templates:list', async (_event, connectionId: string) => {
    try {
      const client = getClient(connectionId)
      const [indexTemplates, legacyTemplates] = await Promise.all([
        client.indices.getIndexTemplate().catch(() => ({ index_templates: [] })),
        client.indices.getTemplate().catch(() => ({}))
      ])

      const composable = (
        ((indexTemplates as { index_templates?: Array<Record<string, unknown>> }).index_templates || [])
      ).map((item) => {
        const template = item.index_template as
          | { index_patterns?: string[]; priority?: number; version?: number }
          | undefined

        return {
          name: String(item.name),
          type: 'index_template' as const,
          indexPatterns: template?.index_patterns,
          priority: template?.priority,
          version: template?.version
        }
      })

      const legacy = Object.entries(legacyTemplates as Record<string, Record<string, unknown>>).map(
        ([name, template]) => ({
          name,
          type: 'legacy_template' as const,
          indexPatterns: template.index_patterns as string[] | undefined,
          version: template.version as number | undefined
        })
      )

      return ok<TemplateSummary[]>([...composable, ...legacy].sort((a, b) => a.name.localeCompare(b.name)))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'templates:get',
    async (
      _event,
      payload: { connectionId: string; name: string; type: 'index_template' | 'legacy_template' }
    ) => {
      try {
        const client = getClient(payload.connectionId)
        const template =
          payload.type === 'index_template'
            ? await client.indices.getIndexTemplate({ name: payload.name })
            : await client.indices.getTemplate({ name: payload.name })

        return ok(template as Record<string, unknown>)
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('templates:put', async (_event, payload: TemplatePutRequest) => {
    try {
      const client = getClient(payload.connectionId)
      if (payload.type === 'index_template') {
        await client.indices.putIndexTemplate({
          name: payload.name,
          body: payload.body
        })
      } else {
        await client.indices.putTemplate({
          name: payload.name,
          body: payload.body
        })
      }

      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('templates:delete', async (_event, payload: TemplateDeleteRequest) => {
    try {
      const client = getClient(payload.connectionId)
      if (payload.type === 'index_template') {
        await client.indices.deleteIndexTemplate({ name: payload.name })
      } else {
        await client.indices.deleteTemplate({ name: payload.name })
      }

      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('documents:search', async (_event, payload: DocumentSearchRequest) => {
    try {
      return ok<DocumentSearchResult>(await searchDocuments(getClient(payload.connectionId), payload))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('documents:aggregate', async (_event, payload: DocumentAggregationRequest) => {
    try {
      return ok<DocumentAggregationResult>(await aggregateDocuments(getClient(payload.connectionId), payload))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('documents:create', async (_event, payload: DocumentWriteRequest) => {
    try {
      await getClient(payload.connectionId).index({
        index: payload.index,
        id: payload.id || undefined,
        document: payload.document,
        refresh: payload.refresh
      })
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('documents:update', async (_event, payload: DocumentUpdateRequest) => {
    try {
      await getClient(payload.connectionId).update({
        index: payload.index,
        id: payload.id,
        doc: payload.doc,
        refresh: payload.refresh
      })
      return ok(undefined)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'documents:delete',
    async (_event, payload: { connectionId: string; index: string; id: string; refresh?: boolean }) => {
      try {
        await getClient(payload.connectionId).delete({
          index: payload.index,
          id: payload.id,
          refresh: payload.refresh
        })
        return ok(undefined)
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('documents:import', async (event, payload: DocumentImportRequest) => {
    try {
      const client = getClient(payload.connectionId)
      const targetMode = payload.mode || 'existing'
      const targetIndex = (payload.targetIndex || payload.index).trim()
      if (!targetIndex) {
        throw new Error('请选择目标索引')
      }
      if (/[*?,]/.test(targetIndex)) {
        throw new Error('导入目标必须是单个索引，不能包含通配符或多个索引')
      }
      emitProgress(event.sender, {
        operationId: payload.operationId,
        type: 'import',
        phase: 'parsing',
        current: 0,
        message: '正在解析导入文件'
      })
      const parsedPayload: ParsedImportFile = payload.documents?.length
        ? { documents: payload.documents }
        : payload.content
          ? parseImportPayload(payload.content, payload.index)
          : { documents: [] }
      const documents = parsedPayload.documents
      const result: DocumentImportResult = {
        imported: 0,
        failed: 0,
        targetIndices: [],
        overwritten: 0,
        created: 0,
        mode: 'upsert',
        targetMode,
        indexCreated: false,
        errors: []
      }

      if (!documents.length) {
        throw new Error('没有可导入的文档')
      }

      if (targetMode === 'create') {
        const createBody = extractCreateIndexBody(parsedPayload, payload.index)
        if (!createBody) {
          throw new Error('导入文件没有可用于创建索引的 mapping')
        }
        emitProgress(event.sender, {
          operationId: payload.operationId,
          type: 'import',
          phase: 'creating-index',
          current: 0,
          total: documents.length,
          message: `正在创建索引 ${targetIndex}`
        })
        await client.indices.create({
          index: targetIndex,
          ...(createBody ? { body: createBody } : {})
        })
        result.indexCreated = true
      }

      const targetIndices = new Set<string>()
      targetIndices.add(targetIndex)
      emitProgress(event.sender, {
        operationId: payload.operationId,
        type: 'import',
        phase: 'importing',
        current: 0,
        total: documents.length,
        message: `准备导入 ${documents.length} 条文档到 ${targetIndex}`
      })

      for (const [index, item] of documents.entries()) {
        try {
          await client.index({
            index: targetIndex,
            id: item.id || undefined,
            document: item.document,
            refresh: payload.refresh
          })
          result.imported += 1
          if (item.id) {
            result.overwritten += 1
          } else {
            result.created += 1
          }
        } catch (error) {
          result.failed += 1
          result.errors.push({
            id: item.id,
            index: targetIndex,
            message: error instanceof Error ? error.message : '导入失败'
          })
        }

        if ((index + 1) % IMPORT_PROGRESS_BATCH_SIZE === 0 || index === documents.length - 1) {
          emitProgress(event.sender, {
            operationId: payload.operationId,
            type: 'import',
            phase: 'importing',
            current: index + 1,
            total: documents.length,
            message: `已处理 ${index + 1}/${documents.length} 条`
          })
        }
      }

      result.targetIndices = Array.from(targetIndices)
      emitProgress(event.sender, {
        operationId: payload.operationId,
        type: 'import',
        phase: 'done',
        current: documents.length,
        total: documents.length,
        message: `导入完成：成功 ${result.imported} 条，失败 ${result.failed} 条`
      })
      return ok(result)
    } catch (error) {
      emitProgress(event.sender, {
        operationId: payload.operationId,
        type: 'import',
        phase: 'error',
        current: 0,
        message: error instanceof Error ? error.message : '导入失败'
      })
      return fail(error)
    }
  })

  ipcMain.handle(
    'documents:export',
    async (event, payload: DocumentExportRequest) => {
      try {
        const client = getClient(payload.connectionId)
        const body = normalizeSearchBody(parseSearchBody(payload.queryText))
        const documents: DocumentImportItem[] = []
        let searchAfter: unknown[] | undefined
        let total = 0
        const exportSort = getDeepPageSort(body)
        const mappings = (await client.indices.getMapping({
          index: payload.index
        })) as Record<string, unknown>

        emitProgress(event.sender, {
          operationId: payload.operationId,
          type: 'export',
          phase: 'querying',
          current: 0,
          message: '正在统计可导出数据'
        })

        while (documents.length < MAX_EXPORT_DOCUMENTS) {
          const result = (await client.search({
            index: payload.index,
            size: Math.min(DEEP_PAGE_BATCH_SIZE, MAX_EXPORT_DOCUMENTS - documents.length),
            track_total_hits: documents.length === 0,
            body: {
              ...body,
              sort: exportSort,
              ...(searchAfter ? { search_after: searchAfter } : {})
            }
          })) as Record<string, unknown>
          const hits = extractHits(result)

          if (documents.length === 0) {
            total = extractTotal(result)
            emitProgress(event.sender, {
              operationId: payload.operationId,
              type: 'export',
              phase: 'exporting',
              current: 0,
              total: Math.min(total, MAX_EXPORT_DOCUMENTS),
              message: `准备导出 ${Math.min(total, MAX_EXPORT_DOCUMENTS)} 条文档`
            })
          }

          if (!hits.length) {
            break
          }

          hits.forEach((hit) => {
            const row = flattenHit(hit)
            documents.push({
              id: row._id,
              index: row._index,
              document: row._source
            })
          })

          searchAfter = getSortValues(hits[hits.length - 1])
          emitProgress(event.sender, {
            operationId: payload.operationId,
            type: 'export',
            phase: 'exporting',
            current: documents.length,
            total: Math.min(total || documents.length, MAX_EXPORT_DOCUMENTS),
            message: `已读取 ${documents.length}/${Math.min(total || documents.length, MAX_EXPORT_DOCUMENTS)} 条`
          })
          if (!searchAfter || hits.length < DEEP_PAGE_BATCH_SIZE) {
            break
          }
        }

        emitProgress(event.sender, {
          operationId: payload.operationId,
          type: 'export',
          phase: 'serializing',
          current: documents.length,
          total: Math.min(total || documents.length, MAX_EXPORT_DOCUMENTS),
          message: '正在生成导出文件内容'
        })
        const exportPayload: DocumentExportPayload = {
          index: payload.index,
          exportedAt: new Date().toISOString(),
          total,
          exported: documents.length,
          truncated: documents.length < total,
          mappings,
          documents
        }
        const content = JSON.stringify(exportPayload, null, 2)

        emitProgress(event.sender, {
          operationId: payload.operationId,
          type: 'export',
          phase: 'done',
          current: documents.length,
          total: Math.min(total || documents.length, MAX_EXPORT_DOCUMENTS),
          message: `导出内容已生成：${documents.length} 条`
        })

        return ok(content)
      } catch (error) {
        emitProgress(event.sender, {
          operationId: payload.operationId,
          type: 'export',
          phase: 'error',
          current: 0,
          message: error instanceof Error ? error.message : '导出失败'
        })
        return fail(error)
      }
    }
  )
}

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: 'ES 客户端',
    backgroundColor: '#f6f8fb',
    webPreferences: {
      preload: join(currentDir, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer:load-failed] ${errorCode} ${errorDescription} ${validatedURL}`)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(currentDir, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
