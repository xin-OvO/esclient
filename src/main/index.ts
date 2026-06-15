import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import { Client } from '@elastic/elasticsearch'
import type {
  ApiResult,
  ClusterHealth,
  ConnectionInfo,
  ConnectionInput,
  ConnectionProfile,
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

const parseLiteralValue = (rawValue: string): string | number | boolean | null => {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return ''
  }

  const unquoted = trimmed.replace(/^['"]|['"]$/g, '')
  const lower = unquoted.toLowerCase()

  if (lower === 'true') return true
  if (lower === 'false') return false
  if (lower === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(unquoted)) return Number(unquoted)

  return unquoted
}

const splitConditionText = (
  text: string
): { parts: string[]; connectors: Array<'and' | 'or'> } => {
  const parts: string[] = []
  const connectors: Array<'and' | 'or'> = []
  let current = ''
  let quote: '"' | "'" | undefined
  let parenDepth = 0

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const nextChunk = text.slice(index)

    if ((char === '"' || char === "'") && text[index - 1] !== '\\') {
      quote = quote === char ? undefined : quote || char
      current += char
      continue
    }

    if (!quote) {
      if (char === '(') parenDepth += 1
      if (char === ')') parenDepth = Math.max(0, parenDepth - 1)

      const connectorMatch = nextChunk.match(/^\s+(and|or)\s+/i)
      if (parenDepth === 0 && connectorMatch) {
        parts.push(current.trim())
        connectors.push(connectorMatch[1].toLowerCase() as 'and' | 'or')
        index += connectorMatch[0].length - 1
        current = ''
        continue
      }
    }

    current += char
  }

  if (current.trim()) {
    parts.push(current.trim())
  }

  return { parts, connectors }
}

const parseConditionClause = (clause: string): Record<string, unknown> => {
  const match = clause.match(/^([\w.@-]+)\s*(>=|<=|!=|=|>|<|like|in)\s*(.+)$/i)
  if (!match) {
    throw new Error(`查询条件格式不正确：${clause}`)
  }

  const [, field, rawOperator, rawValue] = match
  const operator = rawOperator.toLowerCase()

  if (operator === 'like') {
    const value = String(parseLiteralValue(rawValue)).replace(/\*/g, '')
    return { wildcard: { [field]: `*${value}*` } }
  }

  if (operator === 'in') {
    const normalized = rawValue.trim().replace(/^\(|\)$/g, '').replace(/^\[|\]$/g, '')
    const values = normalized
      .split(',')
      .map((item) => parseLiteralValue(item))
      .filter((item) => item !== '')

    if (!values.length) {
      throw new Error(`in 查询至少需要一个值：${clause}`)
    }

    return { terms: { [field]: values } }
  }

  const value = parseLiteralValue(rawValue)

  if (operator === '=') {
    if (typeof value === 'string') {
      return { match_phrase: { [field]: value } }
    }

    return { term: { [field]: value } }
  }

  if (operator === '!=') {
    return {
      bool: {
        must_not: [
          typeof value === 'string'
            ? { match_phrase: { [field]: value } }
            : { term: { [field]: value } }
        ]
      }
    }
  }

  const rangeOperatorMap: Record<string, string> = {
    '>=': 'gte',
    '<=': 'lte',
    '>': 'gt',
    '<': 'lt'
  }

  return { range: { [field]: { [rangeOperatorMap[operator]]: value } } }
}

const parseConditionQuery = (text: string): Record<string, unknown> => {
  const { parts, connectors } = splitConditionText(text)
  const queries = parts.map(parseConditionClause)

  if (!queries.length) {
    return { query: { match_all: {} } }
  }

  if (connectors.length && connectors.some((item) => item === 'or')) {
    const groups: Array<Record<string, unknown>[]> = [[]]

    queries.forEach((query, index) => {
      groups[groups.length - 1].push(query)
      if (connectors[index] === 'or') {
        groups.push([])
      }
    })

    const should = groups
      .filter((group) => group.length)
      .map((group) => (group.length === 1 ? group[0] : { bool: { must: group } }))

    return { query: { bool: { should, minimum_should_match: 1 } } }
  }

  return { query: { bool: { must: queries } } }
}

const parseSearchBody = (text?: string): Record<string, unknown> => {
  if (!text?.trim()) {
    return { query: { match_all: {} } }
  }

  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) {
    return parseConditionQuery(trimmed)
  }

  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON 查询必须是对象')
  }

  return parsed as Record<string, unknown>
}

const flattenHit = (hit: Record<string, unknown>): DocumentRow => ({
  _id: String(hit._id),
  _index: String(hit._index),
  _score: typeof hit._score === 'number' ? hit._score : null,
  _source: ((hit._source || {}) as Record<string, unknown>) || {}
})

const registerIpc = (): void => {
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
      const body = parseSearchBody(payload.queryText)
      const result = (await getClient(payload.connectionId).search({
        index: payload.index,
        from: payload.from || 0,
        size: payload.size || 50,
        body
      })) as Record<string, unknown>

      const hitsRoot = result.hits as
        | {
            hits?: Array<Record<string, unknown>>
            total?: number | { value?: number }
          }
        | undefined
      const total =
        typeof hitsRoot?.total === 'number'
          ? hitsRoot.total
          : typeof hitsRoot?.total?.value === 'number'
            ? hitsRoot.total.value
            : 0

      return ok<DocumentSearchResult>({
        rows: (hitsRoot?.hits || []).map(flattenHit),
        total,
        took: result.took as number | undefined
      })
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
