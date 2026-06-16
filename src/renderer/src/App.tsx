import React from 'react'
import Alert from 'antd/es/alert'
import AntApp from 'antd/es/app'
import Badge from 'antd/es/badge'
import Button from 'antd/es/button'
import Card from 'antd/es/card'
import Descriptions from 'antd/es/descriptions'
import Empty from 'antd/es/empty'
import Form from 'antd/es/form'
import Input from 'antd/es/input'
import InputNumber from 'antd/es/input-number'
import Layout from 'antd/es/layout'
import Modal from 'antd/es/modal'
import Popconfirm from 'antd/es/popconfirm'
import Progress from 'antd/es/progress'
import Radio from 'antd/es/radio'
import Select from 'antd/es/select'
import Space from 'antd/es/space'
import Spin from 'antd/es/spin'
import Splitter from 'antd/es/splitter'
import Table from 'antd/es/table'
import Tabs from 'antd/es/tabs'
import Tag from 'antd/es/tag'
import Tooltip from 'antd/es/tooltip'
import Tree from 'antd/es/tree'
import Typography from 'antd/es/typography'
import type { DataNode } from 'antd/es/tree'
import type { ColumnsType } from 'antd/es/table'
import {
  Braces,
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Folder,
  Info,
  KeyRound,
  Layers,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings,
  Table2,
  Trash2,
  Upload,
  Eye
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AuthType,
  ClusterHealth,
  ConnectionInfo,
  ConnectionInput,
  ConnectionProfile,
  DocumentAggregationResult,
  AggregationMetric,
  OperationProgress,
  DocumentRow,
  DocumentExportPayload,
  DocumentSearchResult,
  IndexSummary,
  TemplateSummary
} from '../../shared/types'
import { formatConditionDsl } from '../../shared/query'

const { Header, Sider, Content } = Layout
const { Text, Title } = Typography
const DEFAULT_QUERY = '{\n  "query": {\n    "match_all": {}\n  }\n}'
const DEFAULT_CONDITION_QUERY = ''
const DEFAULT_INDEX_BODY = '{\n  "settings": {},\n  "mappings": {\n    "properties": {}\n  }\n}'
const DEFAULT_TEMPLATE_BODY =
  '{\n  "index_patterns": ["logs-*"],\n  "template": {\n    "settings": {},\n    "mappings": {\n      "properties": {}\n    }\n  }\n}'
const DEFAULT_PAGE_SIZE = 50

type WorkspaceView =
  | { type: 'welcome' }
  | { type: 'connection'; connectionId: string }
  | { type: 'cluster'; connectionId: string }
  | { type: 'indices'; connectionId: string }
  | { type: 'index'; connectionId: string; index: string; section: IndexSection }
  | { type: 'templates'; connectionId: string }
  | { type: 'template'; connectionId: string; name: string; templateType: 'index_template' | 'legacy_template' }

type IndexSection = 'data' | 'mapping' | 'aggregation'
type QueryMode = 'condition' | 'dsl'

interface EditableCell {
  rowId: string
  rowIndex: string
  field: string
  originalValue?: unknown
}

interface MappingField {
  path: string
  type: string
  input: 'text' | 'number' | 'boolean' | 'json'
  aggregatablePath?: string
  metricCapable: boolean
}

interface QueryPreset {
  id: string
  name: string
  mode: QueryMode
  text: string
  sortField?: string
  sortOrder: 'asc' | 'desc'
  updatedAt: string
}

interface DocumentViewPreference {
  visibleFields: string[]
  sortField?: string
  sortOrder: 'asc' | 'desc'
  pageSize: number
}

type ImportTargetMode = 'existing' | 'create'

interface ImportPreview {
  index?: string
  mappings?: Record<string, unknown>
  documentCount: number
}

interface PendingImportFile {
  content: string
  filePath?: string
  preview: ImportPreview
}

const api = window.esClient

const callApi = async <T,>(operation: () => Promise<{ ok: true; data: T } | { ok: false; error: { code?: string; message: string } }>) => {
  if (!api) {
    return {
      ok: false as const,
      error: { message: '客户端接口未加载，请重启应用' }
    }
  }

  try {
    return await operation()
  } catch (error) {
    return {
      ok: false as const,
      error: { message: error instanceof Error ? error.message : '操作失败，请重试' }
    }
  }
}

const formatJson = (value: unknown): string => JSON.stringify(value, null, 2)

const toConditionDsl = (value: string): string => {
  try {
    return formatConditionDsl(value)
  } catch {
    return DEFAULT_QUERY
  }
}

const useSyncedQueryState = (): {
  queryMode: QueryMode
  setQueryMode: (mode: QueryMode) => void
  conditionText: string
  dslText: string
  queryText: string
  handleQueryTextChange: (value: string) => void
  setQueryState: (mode: QueryMode, text: string) => void
  resetQuery: () => void
} => {
  const [queryMode, setQueryMode] = useState<QueryMode>('condition')
  const [conditionText, setConditionText] = useState(DEFAULT_CONDITION_QUERY)
  const [dslText, setDslText] = useState(() => toConditionDsl(DEFAULT_CONDITION_QUERY))

  const handleQueryTextChange = (value: string): void => {
    if (queryMode === 'condition') {
      setConditionText(value)
      try {
        setDslText(formatConditionDsl(value))
      } catch {
        // Keep the last valid DSL while the user is still editing an incomplete condition.
      }
      return
    }

    setDslText(value)
  }

  const resetQuery = (): void => {
    setConditionText(DEFAULT_CONDITION_QUERY)
    setDslText(toConditionDsl(DEFAULT_CONDITION_QUERY))
  }

  const setQueryState = (mode: QueryMode, text: string): void => {
    setQueryMode(mode)
    if (mode === 'condition') {
      setConditionText(text)
      setDslText(toConditionDsl(text))
      return
    }

    setDslText(text || DEFAULT_QUERY)
  }

  return {
    queryMode,
    setQueryMode,
    conditionText,
    dslText,
    queryText: queryMode === 'condition' ? conditionText : dslText,
    handleQueryTextChange,
    setQueryState,
    resetQuery
  }
}

const parseJson = (value: string): Record<string, unknown> => {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请输入 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

const resultMessage = (error: { code?: string; message: string } | undefined): string => {
  if (!error) {
    return '操作失败'
  }

  const message = error.message || '操作失败'
  const lowerMessage = message.toLowerCase()
  let hint = ''

  if (lowerMessage.includes('fielddata') || lowerMessage.includes('text fields are not optimised')) {
    hint = '。如果是 text 字段，请改用对应的 keyword 子字段排序/聚合'
  } else if (lowerMessage.includes('no mapping found')) {
    hint = '。请确认字段名存在，或换一个字段'
  } else if (lowerMessage.includes('failed to parse') || lowerMessage.includes('json')) {
    hint = '。请检查 DSL/JSON 格式'
  }

  const code = error.code && error.code !== 'Error' ? `（${error.code}）` : ''
  return `${message}${hint}${code}`
}

const createOperationId = (prefix: string): string => {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const inspectImportContent = (content: string): ImportPreview => {
  const trimmed = content.trim()
  if (!trimmed) {
    return { documentCount: 0 }
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) {
      return { documentCount: parsed.length }
    }

    if (isPlainRecord(parsed)) {
      return {
        index: typeof parsed.index === 'string' ? parsed.index : undefined,
        mappings: isPlainRecord(parsed.mappings) ? parsed.mappings : undefined,
        documentCount: Array.isArray(parsed.documents) ? parsed.documents.length : 1
      }
    }
  } catch {
    // Fall through to line-based preview.
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  let count = 0
  for (let index = 0; index < lines.length; index += 1) {
    try {
      const parsed = JSON.parse(lines[index]) as unknown
      if (isPlainRecord(parsed) && (isPlainRecord(parsed.index) || isPlainRecord(parsed.create))) {
        count += 1
        index += 1
      } else {
        count += 1
      }
    } catch {
      count += 1
    }
  }
  return { documentCount: count }
}

const suggestedImportIndex = (index: string): string => {
  const safeIndex = index
    .toLowerCase()
    .replace(/[*?,]+/g, '')
    .replace(/[^a-z0-9._-]+/g, '_')
  return `${safeIndex || 'imported'}_copy`
}

const hasIndexWildcard = (index: string): boolean => /[*?,]/.test(index)

const getSourceValue = (row: DocumentRow, field: string): unknown => row._source[field]

const buildQueryTextWithSort = (
  queryText: string,
  sortField?: string,
  sortOrder: 'asc' | 'desc' = 'desc'
): string => {
  if (!sortField) {
    return queryText
  }

  const body = parseJson(queryText || DEFAULT_QUERY)
  return formatJson({
    ...body,
    sort: [{ [sortField]: { order: sortOrder, unmapped_type: 'keyword' } }]
  })
}

const storageKey = (...parts: string[]): string => {
  return `esclient:${parts.map((part) => encodeURIComponent(part)).join(':')}`
}

const readStorageJson = <T,>(key: string, fallback: T): T => {
  try {
    const value = window.localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

const writeStorageJson = (key: string, value: unknown): void => {
  window.localStorage.setItem(key, JSON.stringify(value))
}

const normalizeEditableValue = (value: string): unknown => {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (!Number.isNaN(Number(trimmed)) && /^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)

  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}

const normalizeValueForOriginalType = (value: string, originalValue?: unknown): unknown => {
  const trimmed = value.trim()

  if (typeof originalValue === 'boolean') {
    if (['1', 'true', 'yes', 'y'].includes(trimmed.toLowerCase())) return true
    if (['0', 'false', 'no', 'n'].includes(trimmed.toLowerCase())) return false
  }

  return normalizeEditableValue(value)
}

const fieldInputType = (type: string): MappingField['input'] => {
  if (['byte', 'short', 'integer', 'long', 'float', 'half_float', 'scaled_float', 'double'].includes(type)) {
    return 'number'
  }

  if (type === 'boolean') {
    return 'boolean'
  }

  if (['object', 'nested', 'flattened', 'join', 'geo_point', 'geo_shape'].includes(type)) {
    return 'json'
  }

  return 'text'
}

const isNumberFieldType = (type: string): boolean => {
  return ['byte', 'short', 'integer', 'long', 'float', 'half_float', 'scaled_float', 'double'].includes(type)
}

const isDirectlyAggregatableType = (type: string): boolean => {
  return [
    'keyword',
    'constant_keyword',
    'wildcard',
    'boolean',
    'date',
    'date_nanos',
    'ip',
    'version',
    'byte',
    'short',
    'integer',
    'long',
    'float',
    'half_float',
    'scaled_float',
    'double'
  ].includes(type)
}

const extractMappingFields = (mapping: Record<string, unknown>, index: string): MappingField[] => {
  const indexMapping =
    (mapping[index] as { mappings?: { properties?: Record<string, unknown> } } | undefined) ||
    (Object.values(mapping)[0] as { mappings?: { properties?: Record<string, unknown> } } | undefined)
  const properties = indexMapping?.mappings?.properties

  if (!properties) {
    return []
  }

  const fields: MappingField[] = []

  const visit = (items: Record<string, unknown>, prefix = ''): void => {
    Object.entries(items).forEach(([name, rawDefinition]) => {
      if (!rawDefinition || typeof rawDefinition !== 'object' || Array.isArray(rawDefinition)) {
        return
      }

      const definition = rawDefinition as {
        type?: string
        properties?: Record<string, unknown>
        fields?: Record<string, { type?: string }>
      }
      const path = prefix ? `${prefix}.${name}` : name
      const type = definition.type || (definition.properties ? 'object' : 'unknown')
      const keywordSubField = Object.entries(definition.fields || {}).find(([, subField]) =>
        ['keyword', 'constant_keyword', 'wildcard'].includes(subField.type || '')
      )?.[0]
      const aggregatablePath = isDirectlyAggregatableType(type)
        ? path
        : keywordSubField
          ? `${path}.${keywordSubField}`
          : undefined

      if (type === 'nested') {
        fields.push({ path, type, input: 'json', metricCapable: false })
        return
      }

      if (definition.properties && type === 'object') {
        visit(definition.properties, path)
        return
      }

      fields.push({
        path,
        type,
        input: fieldInputType(type),
        aggregatablePath,
        metricCapable: isNumberFieldType(type)
      })
    })
  }

  visit(properties)
  return fields
}

const parseMappingFieldValue = (field: MappingField, rawValue: string): unknown => {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return undefined
  }

  if (field.input === 'number') {
    const value = Number(trimmed)
    if (Number.isNaN(value)) {
      throw new Error(`${field.path} 需要填写数字`)
    }
    return value
  }

  if (field.input === 'boolean') {
    if (['true', '1', 'yes', 'y'].includes(trimmed.toLowerCase())) return true
    if (['false', '0', 'no', 'n'].includes(trimmed.toLowerCase())) return false
    throw new Error(`${field.path} 需要填写 true/false`)
  }

  if (field.input === 'json') {
    try {
      return JSON.parse(trimmed) as unknown
    } catch {
      throw new Error(`${field.path} 需要填写合法 JSON`)
    }
  }

  return rawValue
}

const setNestedDocumentValue = (
  target: Record<string, unknown>,
  path: string,
  value: unknown
): void => {
  const parts = path.split('.')
  let current = target

  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      current[part] = value
      return
    }

    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {}
    }

    current = current[part] as Record<string, unknown>
  })
}

function App(): JSX.Element {
  const { message } = AntApp.useApp()
  const [connections, setConnections] = useState<ConnectionProfile[]>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>()
  const [view, setView] = useState<WorkspaceView>({ type: 'welcome' })
  const [loadingConnections, setLoadingConnections] = useState(false)
  const [connectionModalOpen, setConnectionModalOpen] = useState(false)
  const [editingConnection, setEditingConnection] = useState<ConnectionProfile | undefined>()
  const [resourceVersion, setResourceVersion] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [indexFilters, setIndexFilters] = useState<Record<string, string>>({})

  const loadConnections = async (): Promise<void> => {
    setLoadingConnections(true)
    try {
      const result = await callApi(() => api.connections.list())

      if (result.ok) {
        setConnections(result.data)
        if (!selectedConnectionId && result.data.length) {
          setSelectedConnectionId(result.data[0].id)
          setView({ type: 'connection', connectionId: result.data[0].id })
        }
      } else {
        message.error(resultMessage(result.error))
      }
    } finally {
      setLoadingConnections(false)
    }
  }

  useEffect(() => {
    void loadConnections()
  }, [])

  const selectedConnection = connections.find((item) => item.id === selectedConnectionId)

  const treeData: DataNode[] = connections.map((connection) => ({
    key: `connection:${connection.id}`,
    title: (
      <Space size={6}>
        <Server size={15} />
        <span>{connection.name}</span>
      </Space>
    ),
    children: [
      {
        key: `connection-info:${connection.id}`,
        title: (
          <Space size={6}>
            <Info size={14} />
            <span>连接信息</span>
          </Space>
        )
      },
      {
        key: `cluster:${connection.id}`,
        title: (
          <Space size={6}>
            <Settings size={14} />
            <span>集群配置</span>
          </Space>
        )
      },
      {
        key: `indices:${connection.id}`,
        title: (
          <Space size={6}>
            <Folder size={14} />
            <span>索引</span>
          </Space>
        )
      },
      {
        key: `templates:${connection.id}`,
        title: (
          <Space size={6}>
            <Layers size={14} />
            <span>模板</span>
          </Space>
        )
      }
    ]
  }))

  const handleTreeSelect = (keys: React.Key[]): void => {
    const key = String(keys[0] || '')
    const [kind, connectionId] = key.split(':')
    if (!connectionId) return
    setSelectedConnectionId(connectionId)

    if (kind === 'connection' || kind === 'connection-info') {
      setView({ type: 'connection', connectionId })
    }

    if (kind === 'cluster') {
      setView({ type: 'cluster', connectionId })
    }

    if (kind === 'indices') {
      setView({ type: 'indices', connectionId })
    }

    if (kind === 'templates') {
      setView({ type: 'templates', connectionId })
    }
  }

  const refreshResources = (): void => {
    setResourceVersion((value) => value + 1)
  }

  const setIndexFilterForConnection = (connectionId: string, value: string): void => {
    setIndexFilters((current) => ({
      ...current,
      [connectionId]: value
    }))
  }

  return (
    <Layout className="app-shell">
        <Header className="top-bar">
          <div className="brand">
            <Database size={22} />
            <div>
              <strong>ES 中文客户端</strong>
              <span>Elasticsearch 管理工作台</span>
            </div>
          </div>
          <Space className="toolbar">
            <Tooltip title={sidebarCollapsed ? '展开资源管理器' : '收起资源管理器'}>
              <Button
                icon={sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                onClick={() => setSidebarCollapsed((value) => !value)}
              />
            </Tooltip>
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={() => {
                setEditingConnection(undefined)
                setConnectionModalOpen(true)
              }}
            >
              新建连接
            </Button>
            <Button icon={<RefreshCw size={16} />} onClick={refreshResources}>
              刷新
            </Button>
          </Space>
        </Header>

        <Layout className="main-layout">
          <Sider
            width={292}
            collapsedWidth={44}
            collapsed={sidebarCollapsed}
            className="sidebar"
            trigger={null}
          >
            <div className="sidebar-head">
              {!sidebarCollapsed && <Text strong>资源管理器</Text>}
              <Space size={4}>
                {!sidebarCollapsed && (
                  <Tooltip title="刷新连接列表">
                    <Button size="small" icon={<RefreshCw size={14} />} onClick={() => void loadConnections()} />
                  </Tooltip>
                )}
                <Tooltip title={sidebarCollapsed ? '展开连接列表' : '收起连接列表'}>
                  <Button
                    size="small"
                    icon={sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
                    onClick={() => setSidebarCollapsed((value) => !value)}
                  />
                </Tooltip>
              </Space>
            </div>
            {!sidebarCollapsed && (
              <>
                {loadingConnections ? (
                  <div className="center-box">
                    <Spin />
                  </div>
                ) : treeData.length ? (
                  <Tree
                    showLine
                    defaultExpandAll
                    treeData={treeData}
                    selectedKeys={
                      view.type === 'welcome'
                        ? []
                        : [`${view.type === 'connection' ? 'connection-info' : view.type}:${view.connectionId}`]
                    }
                    onSelect={handleTreeSelect}
                  />
                ) : (
                  <Empty
                    className="empty-sidebar"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="暂无连接"
                  />
                )}
              </>
            )}
          </Sider>

          <Content className="workspace">
            <Workspace
              key={`${view.type}:${resourceVersion}`}
              view={view}
              connections={connections}
              selectedConnection={selectedConnection}
              onEditConnection={(connection) => {
                setEditingConnection(connection)
                setConnectionModalOpen(true)
              }}
              onRemoveConnection={async (id) => {
                const result = await callApi(() => api.connections.remove(id))
                if (result.ok) {
                  message.success('连接已删除')
                  setSelectedConnectionId(undefined)
                  setView({ type: 'welcome' })
                  await loadConnections()
                } else {
                  message.error(resultMessage(result.error))
                }
              }}
              onOpenIndex={(connectionId, index, section = 'data') =>
                setView({ type: 'index', connectionId, index, section })
              }
              onBackToIndices={(connectionId) => setView({ type: 'indices', connectionId })}
              onOpenTemplate={(connectionId, name, templateType) =>
                setView({ type: 'template', connectionId, name, templateType })
              }
              onRefresh={refreshResources}
              indexFilters={indexFilters}
              onIndexFilterChange={setIndexFilterForConnection}
            />
          </Content>
        </Layout>

        <div className="status-bar">
          <span>当前连接：{selectedConnection?.name || '未选择'}</span>
          <span>连接地址：{selectedConnection?.node || '-'}</span>
          <span>状态：就绪</span>
        </div>

        <ConnectionModal
          open={connectionModalOpen}
          connection={editingConnection}
          onCancel={() => setConnectionModalOpen(false)}
          onSaved={async (connection) => {
            setConnectionModalOpen(false)
            setSelectedConnectionId(connection.id)
            setView({ type: 'connection', connectionId: connection.id })
            await loadConnections()
          }}
        />
    </Layout>
  )
}

function Workspace(props: {
  view: WorkspaceView
  connections: ConnectionProfile[]
  selectedConnection?: ConnectionProfile
  onEditConnection: (connection: ConnectionProfile) => void
  onRemoveConnection: (id: string) => Promise<void>
  onOpenIndex: (connectionId: string, index: string, section?: IndexSection) => void
  onBackToIndices: (connectionId: string) => void
  onOpenTemplate: (
    connectionId: string,
    name: string,
    templateType: 'index_template' | 'legacy_template'
  ) => void
  onRefresh: () => void
  indexFilters: Record<string, string>
  onIndexFilterChange: (connectionId: string, value: string) => void
}): JSX.Element {
  const { view } = props

  if (view.type === 'welcome') {
    return (
      <div className="welcome">
        <Database size={56} />
        <Title level={3}>欢迎使用 ES 中文客户端</Title>
        <Text type="secondary">请先新建连接，然后从左侧资源树查看集群、索引和模板。</Text>
      </div>
    )
  }

  if (view.type === 'connection') {
    const connection = props.connections.find((item) => item.id === view.connectionId)
    return connection ? (
      <ConnectionInfoPanel
        connection={connection}
        onEdit={() => props.onEditConnection(connection)}
        onRemove={() => props.onRemoveConnection(connection.id)}
      />
    ) : (
      <Empty description="连接不存在" />
    )
  }

  if (view.type === 'cluster') {
    return <ClusterPanel connectionId={view.connectionId} />
  }

  if (view.type === 'indices') {
    return (
      <IndicesPanel
        connectionId={view.connectionId}
        onOpenIndex={props.onOpenIndex}
        onRefresh={props.onRefresh}
        indexFilter={props.indexFilters[view.connectionId] || ''}
        onIndexFilterChange={(value) => props.onIndexFilterChange(view.connectionId, value)}
      />
    )
  }

  if (view.type === 'index') {
    return (
      <IndexDetailPanel
        connectionId={view.connectionId}
        index={view.index}
        section={view.section}
        onBack={() => props.onBackToIndices(view.connectionId)}
        onRefresh={props.onRefresh}
      />
    )
  }

  if (view.type === 'templates') {
    return (
      <TemplatesPanel
        connectionId={view.connectionId}
        onOpenTemplate={props.onOpenTemplate}
        onRefresh={props.onRefresh}
      />
    )
  }

  return (
    <TemplateDetailPanel
      connectionId={view.connectionId}
      name={view.name}
      templateType={view.templateType}
      onRefresh={props.onRefresh}
    />
  )
}

function ConnectionModal(props: {
  open: boolean
  connection?: ConnectionProfile
  onCancel: () => void
  onSaved: (connection: ConnectionProfile) => Promise<void>
}): JSX.Element {
  const { message } = AntApp.useApp()
  const [form] = Form.useForm<ConnectionInput>()
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (props.open) {
      form.setFieldsValue({
        name: props.connection?.name || '',
        node: props.connection?.node || 'http://localhost:9200',
        authType: props.connection?.authType || 'none',
        username: props.connection?.username,
        rejectUnauthorized: props.connection?.rejectUnauthorized ?? true
      })
    }
  }, [props.open, props.connection, form])

  const authType = Form.useWatch('authType', form)

  const readValues = async (): Promise<ConnectionInput> => {
    const values = await form.validateFields()
    return {
      name: values.name,
      node: values.node,
      authType: values.authType,
      username: values.username,
      password: values.password,
      apiKey: values.apiKey,
      rejectUnauthorized: values.rejectUnauthorized
    }
  }

  return (
    <Modal
      title={props.connection ? '编辑连接' : '新建连接'}
      open={props.open}
      onCancel={props.onCancel}
      width={560}
      footer={[
        <Button key="cancel" onClick={props.onCancel}>
          取消
        </Button>,
        <Button
          key="test"
          icon={<Search size={16} />}
          loading={testing}
          onClick={async () => {
            setTesting(true)
            try {
              const values = await readValues().catch(() => undefined)
              if (values) {
                const result = await callApi(() => api.connections.test(values))
                if (result.ok) {
                  message.success(`连接成功：${result.data.clusterName || 'Elasticsearch'}`)
                } else {
                  message.error(resultMessage(result.error))
                }
              } else {
                message.error('请先补全连接配置')
              }
            } finally {
              setTesting(false)
            }
          }}
        >
          测试连接
        </Button>,
        <Button
          key="save"
          type="primary"
          icon={<Save size={16} />}
          loading={saving}
          onClick={async () => {
            setSaving(true)
            try {
              const values = await readValues().catch(() => undefined)
              if (values) {
                const result = await callApi(() => api.connections.save({ ...values, id: props.connection?.id }))
                if (result.ok) {
                  message.success('连接已保存')
                  await props.onSaved(result.data)
                } else {
                  message.error(resultMessage(result.error))
                }
              } else {
                message.error('请先补全连接配置')
              }
            } finally {
              setSaving(false)
            }
          }}
        >
          保存
        </Button>
      ]}
    >
      <Form form={form} layout="vertical" initialValues={{ authType: 'none', rejectUnauthorized: true }}>
        <Form.Item name="name" label="连接名称" rules={[{ required: true, message: '请输入连接名称' }]}>
          <Input placeholder="例如：本地开发 ES" />
        </Form.Item>
        <Form.Item name="node" label="连接地址" rules={[{ required: true, message: '请输入连接地址' }]}>
          <Input placeholder="http://localhost:9200" />
        </Form.Item>
        <Form.Item name="authType" label="认证方式">
          <Radio.Group
            options={[
              { label: '无认证', value: 'none' },
              { label: 'Basic Auth', value: 'basic' },
              { label: 'API Key', value: 'apiKey' }
            ]}
          />
        </Form.Item>
        {authType === 'basic' && (
          <>
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<KeyRound size={15} />} />
            </Form.Item>
            <Form.Item name="password" label={props.connection?.hasSecret ? '密码（留空则保持不变）' : '密码'}>
              <Input.Password />
            </Form.Item>
          </>
        )}
        {authType === 'apiKey' && (
          <Form.Item name="apiKey" label={props.connection?.hasSecret ? 'API Key（留空则保持不变）' : 'API Key'}>
            <Input.Password />
          </Form.Item>
        )}
        <Form.Item name="rejectUnauthorized" label="TLS 校验">
          <Select
            options={[
              { value: true, label: '校验证书（推荐）' },
              { value: false, label: '跳过证书校验（内网自签名）' }
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function ConnectionInfoPanel(props: {
  connection: ConnectionProfile
  onEdit: () => void
  onRemove: () => Promise<void>
}): JSX.Element {
  const { message } = AntApp.useApp()
  const [info, setInfo] = useState<ConnectionInfo>()
  const [loading, setLoading] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await callApi(() => api.connections.info(props.connection.id))
      if (result.ok) {
        setInfo(result.data)
      } else {
        message.error(resultMessage(result.error))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [props.connection.id])

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <Title level={4}>连接信息</Title>
          <Text type="secondary">{props.connection.name}</Text>
        </div>
        <Space>
          <Button icon={<RefreshCw size={16} />} onClick={() => void load()}>
            刷新
          </Button>
          <Button onClick={props.onEdit}>编辑连接</Button>
          <Popconfirm
            title="确认删除连接？"
            description="只会删除本地连接配置，不会影响 Elasticsearch 集群。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => void props.onRemove()}
          >
            <Button danger icon={<Trash2 size={16} />}>
              删除连接
            </Button>
          </Popconfirm>
        </Space>
      </div>
      <Spin spinning={loading}>
        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="连接名称">{props.connection.name}</Descriptions.Item>
          <Descriptions.Item label="连接地址">{props.connection.node}</Descriptions.Item>
          <Descriptions.Item label="认证方式">{authTypeLabel(props.connection.authType)}</Descriptions.Item>
          <Descriptions.Item label="TLS 校验">
            {props.connection.rejectUnauthorized ? '校验证书' : '跳过证书校验'}
          </Descriptions.Item>
          <Descriptions.Item label="集群名称">{info?.clusterName || '-'}</Descriptions.Item>
          <Descriptions.Item label="集群 UUID">{info?.clusterUuid || '-'}</Descriptions.Item>
          <Descriptions.Item label="ES 版本">{info?.version || '-'}</Descriptions.Item>
          <Descriptions.Item label="标语">{info?.tagline || '-'}</Descriptions.Item>
        </Descriptions>
      </Spin>
    </section>
  )
}

function ClusterPanel(props: { connectionId: string }): JSX.Element {
  const { message } = AntApp.useApp()
  const [health, setHealth] = useState<ClusterHealth>()
  const [settings, setSettings] = useState<Record<string, unknown>>()
  const [loading, setLoading] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const [healthResult, settingsResult] = await Promise.all([
        callApi(() => api.cluster.health(props.connectionId)),
        callApi(() => api.cluster.settings(props.connectionId))
      ])

      if (healthResult.ok) setHealth(healthResult.data)
      else message.error(resultMessage(healthResult.error))

      if (settingsResult.ok) setSettings(settingsResult.data)
      else message.error(resultMessage(settingsResult.error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [props.connectionId])

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <Title level={4}>集群配置</Title>
          <Text type="secondary">查看集群健康状态和配置。</Text>
        </div>
        <Button icon={<RefreshCw size={16} />} onClick={() => void load()}>
          刷新
        </Button>
      </div>
      <Spin spinning={loading}>
        <Space direction="vertical" size={16} className="full-width">
          <Card size="small" title="集群健康">
            <Descriptions bordered column={4} size="small">
              <Descriptions.Item label="集群名称">{health?.cluster_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={healthColor(String(health?.status || ''))}>{health?.status || '-'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="节点数">{health?.number_of_nodes ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="主分片">{health?.active_primary_shards ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="活动分片">{health?.active_shards ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="迁移中">{health?.relocating_shards ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="初始化">{health?.initializing_shards ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="未分配">{health?.unassigned_shards ?? '-'}</Descriptions.Item>
            </Descriptions>
          </Card>
          <Card size="small" title="集群设置">
            <pre className="json-view">{formatJson(settings || {})}</pre>
          </Card>
        </Space>
      </Spin>
    </section>
  )
}

function IndicesPanel(props: {
  connectionId: string
  onOpenIndex: (connectionId: string, index: string, section?: IndexSection) => void
  onRefresh: () => void
  indexFilter: string
  onIndexFilterChange: (value: string) => void
}): JSX.Element {
  const { message } = AntApp.useApp()
  const [indices, setIndices] = useState<IndexSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await callApi(() => api.indices.list(props.connectionId))
      if (result.ok) setIndices(result.data)
      else message.error(resultMessage(result.error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [props.connectionId])

  const columns: ColumnsType<IndexSummary> = [
    {
      title: '健康',
      dataIndex: 'health',
      width: 90,
      render: (value: string) => <Tag color={healthColor(value)}>{value || '-'}</Tag>
    },
    { title: '状态', dataIndex: 'status', width: 90 },
    {
      title: '索引名称',
      dataIndex: 'index',
      render: (value: string) => (
        <Button type="link" className="link-button" onClick={() => props.onOpenIndex(props.connectionId, value)}>
          {value}
        </Button>
      )
    },
    { title: '主分片', dataIndex: 'pri', width: 90 },
    { title: '副本', dataIndex: 'rep', width: 80 },
    { title: '文档数', dataIndex: 'docsCount', width: 120 },
    { title: '存储', dataIndex: 'storeSize', width: 110 },
    {
      title: '操作',
      width: 260,
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => props.onOpenIndex(props.connectionId, row.index, 'data')}>
            查看数据
          </Button>
          <Button size="small" onClick={() => props.onOpenIndex(props.connectionId, row.index, 'mapping')}>
            映射
          </Button>
          <Popconfirm
            title="确认删除索引？"
            description={`请输入确认后将删除索引 ${row.index}`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              const result = await callApi(() =>
                api.indices.delete({ connectionId: props.connectionId, index: row.index })
              )
              if (result.ok) {
                message.success('索引已删除')
                await load()
                props.onRefresh()
              } else {
                message.error(resultMessage(result.error))
              }
            }}
          >
            <Button size="small" danger icon={<Trash2 size={14} />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  const filteredIndices = useMemo(() => {
    const keyword = props.indexFilter.trim().toLowerCase()
    if (!keyword) return indices

    const pattern = keyword.includes('*')
      ? new RegExp(`^${keyword.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
      : undefined

    return indices.filter((item) => {
      const name = item.index.toLowerCase()
      return pattern ? pattern.test(name) : name.includes(keyword)
    })
  }, [indices, props.indexFilter])

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <Title level={4}>索引</Title>
          <Text type="secondary">查看、创建、删除索引，并打开索引数据和映射。</Text>
        </div>
        <Space>
          <Input
            allowClear
            prefix={<Search size={15} />}
            placeholder="搜索索引名称，支持 * 通配符"
            value={props.indexFilter}
            onChange={(event) => props.onIndexFilterChange(event.target.value)}
            className="index-search"
          />
          <Button icon={<RefreshCw size={16} />} onClick={() => void load()}>
            刷新
          </Button>
          <Button type="primary" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
            新建索引
          </Button>
        </Space>
      </div>
      <Table
        rowKey="index"
        loading={loading}
        columns={columns}
        dataSource={filteredIndices}
        size="small"
        pagination={{ pageSize: 20, showSizeChanger: true }}
      />
      <IndexCreateModal
        open={createOpen}
        connectionId={props.connectionId}
        onCancel={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false)
          await load()
          props.onRefresh()
        }}
      />
    </section>
  )
}

function IndexCreateModal(props: {
  open: boolean
  connectionId: string
  onCancel: () => void
  onCreated: () => Promise<void>
}): JSX.Element {
  const { message } = AntApp.useApp()
  const [name, setName] = useState('')
  const [body, setBody] = useState(DEFAULT_INDEX_BODY)
  const [saving, setSaving] = useState(false)

  return (
    <Modal
      title="新建索引"
      open={props.open}
      onCancel={props.onCancel}
      width={760}
      onOk={async () => {
        setSaving(true)
        try {
          if (!name.trim()) {
            throw new Error('请输入索引名称')
          }
          const result = await callApi(() =>
            api.indices.create({
              connectionId: props.connectionId,
              index: name.trim(),
              body: parseJson(body)
            })
          )
          if (result.ok) {
            message.success('索引已创建')
            await props.onCreated()
          } else {
            message.error(resultMessage(result.error))
          }
        } catch (error) {
          message.error(error instanceof Error ? error.message : '索引创建失败')
        } finally {
          setSaving(false)
        }
      }}
      confirmLoading={saving}
      okText="创建"
      cancelText="取消"
    >
      <Space direction="vertical" className="full-width">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="索引名称" />
        <Input.TextArea
          value={body}
          rows={14}
          onChange={(event) => setBody(event.target.value)}
          className="code-textarea"
        />
      </Space>
    </Modal>
  )
}

function IndexDetailPanel(props: {
  connectionId: string
  index: string
  section: IndexSection
  onBack: () => void
  onRefresh: () => void
}): JSX.Element {
  const [active, setActive] = useState(props.section)
  const [targetIndex, setTargetIndex] = useState(props.index)

  useEffect(() => {
    setActive(props.section)
    setTargetIndex(props.index)
  }, [props.index, props.section])

  return (
    <section className="panel">
      <div className="panel-head">
        <Space align="start">
          <Tooltip title="返回索引列表">
            <Button icon={<ChevronLeft size={16} />} onClick={props.onBack} />
          </Tooltip>
          <div>
            <Title level={4}>索引详情</Title>
            <Text type="secondary">数据查询、映射查看和维护。</Text>
          </div>
        </Space>
      </div>
      <Tabs
        activeKey={active}
        onChange={(key) => setActive(key as IndexSection)}
        items={[
          {
            key: 'data',
            label: (
              <Space size={6}>
                <Table2 size={15} />
                数据
              </Space>
            ),
            children: (
              <DocumentsPanel
                connectionId={props.connectionId}
                index={targetIndex.trim() || props.index}
                baseIndex={props.index}
                targetIndex={targetIndex}
                onTargetIndexChange={setTargetIndex}
              />
            )
          },
          {
            key: 'mapping',
            label: (
              <Space size={6}>
                <Braces size={15} />
                映射
              </Space>
            ),
            children: (
              <MappingPanel
                connectionId={props.connectionId}
                index={targetIndex.trim() || props.index}
                baseIndex={props.index}
                targetIndex={targetIndex}
                onTargetIndexChange={setTargetIndex}
                onRefresh={props.onRefresh}
              />
            )
          },
          {
            key: 'aggregation',
            label: (
              <Space size={6}>
                <ChartColumn size={15} />
                聚合
              </Space>
            ),
            children: (
              <AggregationPanel
                connectionId={props.connectionId}
                index={targetIndex.trim() || props.index}
                baseIndex={props.index}
                targetIndex={targetIndex}
                onTargetIndexChange={setTargetIndex}
              />
            )
          }
        ]}
      />
    </section>
  )
}

function DocumentsPanel(props: {
  connectionId: string
  index: string
  baseIndex: string
  targetIndex: string
  onTargetIndexChange: (value: string) => void
}): JSX.Element {
  const { message } = AntApp.useApp()
  const { queryMode, setQueryMode, queryText, dslText, handleQueryTextChange, setQueryState, resetQuery } = useSyncedQueryState()
  const presetKey = storageKey('query-presets', props.connectionId, props.index)
  const preferenceKey = storageKey('document-preference', props.connectionId, props.index)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [from, setFrom] = useState(0)
  const [result, setResult] = useState<DocumentSearchResult>({ rows: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [operationProgress, setOperationProgress] = useState<OperationProgress>()
  const [activeOperationId, setActiveOperationId] = useState<string>()
  const [editingCell, setEditingCell] = useState<EditableCell>()
  const [editingValue, setEditingValue] = useState('')
  const [savingCell, setSavingCell] = useState(false)
  const [detailRow, setDetailRow] = useState<DocumentRow>()
  const [detailText, setDetailText] = useState('')
  const [savingDetail, setSavingDetail] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [sortField, setSortField] = useState<string>()
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [visibleFields, setVisibleFields] = useState<string[]>([])
  const [queryPresets, setQueryPresets] = useState<QueryPreset[]>([])
  const [presetName, setPresetName] = useState('')
  const [loadedPreferenceKey, setLoadedPreferenceKey] = useState('')
  const [pendingImport, setPendingImport] = useState<PendingImportFile>()
  const [importTargetMode, setImportTargetMode] = useState<ImportTargetMode>('existing')
  const [importTargetIndex, setImportTargetIndex] = useState(props.index)

  const effectiveQueryText = useMemo(
    () => buildQueryTextWithSort(sortField ? dslText : queryText, sortField, sortOrder),
    [dslText, queryText, sortField, sortOrder]
  )

  const load = async (nextFrom = from): Promise<void> => {
    setLoading(true)
    try {
      const response = await callApi(() =>
        api.documents.search({
          connectionId: props.connectionId,
          index: props.index,
          queryText: effectiveQueryText,
          size: pageSize,
          from: nextFrom
        })
      )

      if (response.ok) {
        setResult(response.data)
        setFrom(nextFrom)
      } else {
        message.error(resultMessage(response.error))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const preference = readStorageJson<DocumentViewPreference | undefined>(preferenceKey, undefined)
    setVisibleFields(preference?.visibleFields || [])
    setSortField(preference?.sortField)
    setSortOrder(preference?.sortOrder || 'desc')
    setPageSize(preference?.pageSize || DEFAULT_PAGE_SIZE)
    setQueryPresets(readStorageJson<QueryPreset[]>(presetKey, []))
    setLoadedPreferenceKey(preferenceKey)
    void load(0)
  }, [props.connectionId, props.index])

  useEffect(() => {
    if (loadedPreferenceKey !== preferenceKey) {
      return
    }

    writeStorageJson(preferenceKey, {
      visibleFields,
      sortField,
      sortOrder,
      pageSize
    } satisfies DocumentViewPreference)
  }, [loadedPreferenceKey, preferenceKey, visibleFields, sortField, sortOrder, pageSize])

  useEffect(() => {
    void load(0)
  }, [sortField, sortOrder])

  useEffect(() => {
    if (!api?.progress) {
      return undefined
    }

    return api.progress.onOperationProgress((progress) => {
      setOperationProgress((current) =>
        progress.operationId === activeOperationId || progress.operationId === current?.operationId
          ? progress
          : current
      )
    })
  }, [activeOperationId])

  const exportFileName = (): string => {
    const safeIndex = props.index.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'documents'
    return `${safeIndex}-documents-${new Date().toISOString().slice(0, 10)}.json`
  }

  const saveQueryPreset = (): void => {
    const name = presetName.trim()
    if (!name) {
      message.warning('请输入查询方案名称')
      return
    }

    const nextPreset: QueryPreset = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      mode: queryMode,
      text: queryText,
      sortField,
      sortOrder,
      updatedAt: new Date().toISOString()
    }
    const nextPresets = [nextPreset, ...queryPresets.filter((preset) => preset.name !== name)].slice(0, 20)
    setQueryPresets(nextPresets)
    writeStorageJson(presetKey, nextPresets)
    setPresetName('')
    message.success(`查询方案已保存：${name}`)
  }

  const loadQueryPreset = (presetId: string): void => {
    const preset = queryPresets.find((item) => item.id === presetId)
    if (!preset) {
      return
    }

    setQueryState(preset.mode, preset.text)
    setSortField(preset.sortField)
    setSortOrder(preset.sortOrder)
    message.success(`已加载查询方案：${preset.name}`)
  }

  const deleteQueryPreset = (presetId: string): void => {
    const nextPresets = queryPresets.filter((preset) => preset.id !== presetId)
    setQueryPresets(nextPresets)
    writeStorageJson(presetKey, nextPresets)
    message.success('查询方案已删除')
  }

  const exportCurrentPage = async (): Promise<void> => {
    if (!api) {
      message.error('客户端接口未加载，请重启应用')
      return
    }

    const operationId = createOperationId('export-page')
    setActiveOperationId(operationId)
    setExporting(true)
    setOperationProgress({
      operationId,
      type: 'export',
      phase: 'serializing',
      current: 0,
      total: 1,
      percent: 0,
      message: '正在生成当前页导出内容'
    })
    try {
      const mappingResponse = await callApi(() =>
        api.indices.mapping({
          connectionId: props.connectionId,
          index: props.index
        })
      )
      if (!mappingResponse.ok) {
        message.error(resultMessage(mappingResponse.error))
        return
      }
      const payload: DocumentExportPayload = {
        index: props.index,
        exportedAt: new Date().toISOString(),
        total: result.total,
        exported: result.rows.length,
        from,
        size: pageSize,
        mappings: mappingResponse.data,
        documents: result.rows.map((row) => ({
          id: row._id,
          index: row._index,
          document: row._source
        }))
      }
      const content = JSON.stringify(payload, null, 2)
      setOperationProgress({
        operationId,
        type: 'export',
        phase: 'saving',
        current: 1,
        total: 1,
        percent: 90,
        message: '请选择导出保存位置'
      })
      const saved = await api.files.saveJson({ defaultFileName: exportFileName(), content })
      if (!saved.canceled) {
        setOperationProgress({
          operationId,
          type: 'export',
          phase: 'done',
          current: 1,
          total: 1,
          percent: 100,
          message: `当前页已导出到 ${saved.filePath}`
        })
        Modal.success({
          title: '导出完成',
          content: (
            <Space direction="vertical">
              <Text>导出数量：{result.rows.length} 条</Text>
              <Text>已包含索引 mapping</Text>
              <Text>文件路径：{saved.filePath}</Text>
            </Space>
          )
        })
      }
    } finally {
      setExporting(false)
    }
  }

  const exportAllMatches = async (): Promise<void> => {
    if (!api) {
      message.error('客户端接口未加载，请重启应用')
      return
    }

    const operationId = createOperationId('export-all')
    setActiveOperationId(operationId)
    setOperationProgress({
      operationId,
      type: 'export',
      phase: 'starting',
      current: 0,
      percent: 0,
      message: '准备导出查询结果'
    })
    setExporting(true)
    try {
      const response = await callApi(() =>
        api.documents.export({
          connectionId: props.connectionId,
          index: props.index,
          queryText: effectiveQueryText,
          operationId
        })
      )
      if (!response.ok) {
        message.error(resultMessage(response.error))
        return
      }

      const saved = await api.files.saveJson({ defaultFileName: exportFileName(), content: response.data })
      if (!saved.canceled) {
        const parsed = JSON.parse(response.data) as { exported?: number; total?: number; truncated?: boolean }
        setOperationProgress({
          operationId,
          type: 'export',
          phase: 'done',
          current: parsed.exported || 0,
          total: parsed.exported || 0,
          percent: 100,
          message: `查询结果已导出到 ${saved.filePath}`
        })
        Modal.success({
          title: '导出完成',
          content: (
            <Space direction="vertical">
              <Text>导出索引：{props.index}</Text>
              <Text>导出数量：{parsed.exported || 0} / {parsed.total || 0} 条</Text>
              <Text>已包含索引 mapping</Text>
              {parsed.truncated && <Text type="warning">数据量超过上限，本次最多导出 100000 条。</Text>}
              <Text>文件路径：{saved.filePath}</Text>
            </Space>
          )
        })
      }
    } finally {
      setExporting(false)
    }
  }

  const importDocuments = async (): Promise<void> => {
    if (!api) {
      message.error('客户端接口未加载，请重启应用')
      return
    }

    const operationId = createOperationId('import')
    setActiveOperationId(operationId)
    setOperationProgress({
      operationId,
      type: 'import',
      phase: 'opening',
      current: 0,
      percent: 0,
      message: '请选择导入文件'
    })
    setImporting(true)
    try {
      const opened = await api.files.openJson()
      if (opened.canceled || !opened.content) {
        return
      }
      const preview = inspectImportContent(opened.content)
      setPendingImport({
        content: opened.content,
        filePath: opened.filePath,
        preview
      })
      setImportTargetMode('existing')
      setImportTargetIndex(hasIndexWildcard(props.index) ? props.baseIndex : props.index)
      setOperationProgress({
        operationId,
        type: 'import',
        phase: 'uploading',
        current: 0,
        percent: 0,
        message: `已读取 ${opened.filePath || '导入文件'}，请选择导入方式`
      })
    } finally {
      setImporting(false)
    }
  }

  const confirmImportDocuments = async (): Promise<void> => {
    if (!api || !pendingImport) {
      return
    }

    const targetIndex = importTargetIndex.trim()
    if (!targetIndex) {
      message.warning('请输入目标索引')
      return
    }

    if (hasIndexWildcard(targetIndex)) {
      message.warning('导入目标必须是单个索引，不能包含通配符或多个索引')
      return
    }

    if (importTargetMode === 'create' && !pendingImport.preview.mappings) {
      message.warning('导入文件没有 mapping，无法按导出 mapping 新建索引')
      return
    }

    const operationId = createOperationId('import')
    setActiveOperationId(operationId)
    setImporting(true)
    setOperationProgress({
      operationId,
      type: 'import',
      phase: importTargetMode === 'create' ? 'creating-index' : 'starting',
      current: 0,
      percent: 0,
      message:
        importTargetMode === 'create'
          ? `准备创建索引 ${targetIndex} 并导入数据`
          : `准备导入数据到已有索引 ${targetIndex}`
    })
    try {
      const response = await callApi(() =>
        api.documents.import({
          connectionId: props.connectionId,
          index: props.index,
          targetIndex,
          mode: importTargetMode,
          content: pendingImport.content,
          refresh: true,
          operationId
        })
      )

      if (response.ok) {
        const targetText = response.data.targetIndices.join(', ') || props.index
        setOperationProgress({
          operationId,
          type: 'import',
          phase: 'done',
          current: response.data.imported + response.data.failed,
          total: response.data.imported + response.data.failed,
          percent: 100,
          message: `导入完成：成功 ${response.data.imported} 条，失败 ${response.data.failed} 条`
        })
        Modal.success({
          title: '导入完成',
          content: (
            <Space direction="vertical">
              <Text>目标索引：{targetText}</Text>
              <Text>导入方式：{response.data.targetMode === 'create' ? '新建索引并使用导出 mapping' : '导入到已有索引，复用已有 mapping'}</Text>
              {response.data.indexCreated && <Text>已创建索引：{targetText}</Text>}
              <Text>成功导入：{response.data.imported} 条</Text>
              <Text>失败：{response.data.failed} 条</Text>
              <Text>写入策略：有文档 ID 的记录按 ES index 语义写入，同 ID 会覆盖；无 ID 的记录由 ES 自动生成 ID，为新增。</Text>
              <Text>本次有 ID 写入/可能覆盖：{response.data.overwritten} 条</Text>
              <Text>无 ID 新增：{response.data.created} 条</Text>
            </Space>
          )
        })
        setPendingImport(undefined)
        if (targetIndex !== props.index) {
          props.onTargetIndexChange(targetIndex)
        } else {
          await load(0)
        }
      } else {
        message.error(resultMessage(response.error))
      }
    } finally {
      setImporting(false)
    }
  }

  const fields = useMemo(() => {
    const fieldSet = new Set<string>()
    result.rows.forEach((row) => Object.keys(row._source || {}).forEach((field) => fieldSet.add(field)))
    return Array.from(fieldSet).slice(0, 80)
  }, [result.rows])

  useEffect(() => {
    setVisibleFields((current) => current.filter((field) => fields.includes(field)))
    setSortField((current) => (current && fields.includes(current) ? current : undefined))
  }, [fields])

  const selectedFields = visibleFields.length ? visibleFields : fields
  const fieldOptions = fields.map((field) => ({ value: field, label: field }))
  const sortOptions = [
    { value: '_score', label: '_score' },
    { value: '_id', label: '_id' },
    ...fieldOptions
  ]

  const columns: ColumnsType<DocumentRow> = [
    { title: '_id', dataIndex: '_id', width: 260, fixed: 'left' },
    { title: '_index', dataIndex: '_index', width: 180 },
    ...selectedFields.map((field) => ({
      title: field,
      dataIndex: ['_source', field],
      width: 180,
      ellipsis: true,
      render: (_: unknown, row: DocumentRow) => {
        const value = getSourceValue(row, field)
        return (
          <button
            className="cell-button"
            onDoubleClick={() => {
              setEditingCell({ rowId: row._id, rowIndex: row._index || props.index, field, originalValue: value })
              setEditingValue(typeof value === 'string' ? value : formatJson(value))
            }}
          >
            {typeof value === 'object' && value !== null ? formatJson(value) : String(value ?? '')}
          </button>
        )
      }
    })),
    {
      title: '操作',
      width: 180,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button
            size="small"
            icon={<Eye size={14} />}
            onClick={() => {
              setDetailRow(row)
              setDetailText(formatJson(row._source || {}))
            }}
          >
            详情
          </Button>
          <Popconfirm
            title="确认删除文档？"
            description={`将删除文档 ${row._id}`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
            const response = await callApi(() =>
              api.documents.delete({
                connectionId: props.connectionId,
                index: row._index || props.index,
                id: row._id,
                refresh: true
              })
              )
              if (response.ok) {
                message.success('文档已删除')
                await load(from)
              } else {
                message.error(resultMessage(response.error))
              }
            }}
          >
            <Button size="small" danger icon={<Trash2 size={14} />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div className="sub-panel">
      <Splitter>
        <Splitter.Panel defaultSize={320} min={260} max={460}>
          <div className="query-pane">
            <div className="sub-head">
              <Text strong>查询条件</Text>
              <Space>
                <Radio.Group
                  size="small"
                  value={queryMode}
                  onChange={(event) => {
                    setQueryMode(event.target.value as QueryMode)
                  }}
                  options={[
                    { label: '条件', value: 'condition' },
                    { label: 'DSL', value: 'dsl' }
                  ]}
                />
                <Button
                  size="small"
                  onClick={resetQuery}
                >
                  重置
                </Button>
              </Space>
            </div>
            <Space direction="vertical" size={6} className="full-width query-index-row">
              <Text type="secondary">目标索引</Text>
              <Space.Compact className="full-width">
                <Input
                  value={props.targetIndex}
                  onChange={(event) => props.onTargetIndexChange(event.target.value)}
                  placeholder="查询目标索引，例如 index*"
                />
                <Button onClick={() => props.onTargetIndexChange(props.baseIndex)}>恢复</Button>
              </Space.Compact>
            </Space>
            <Input.TextArea
              value={queryText}
              rows={queryMode === 'condition' ? 5 : 16}
              onChange={(event) => handleQueryTextChange(event.target.value)}
              placeholder={
                queryMode === 'condition'
                  ? '例如：age >= 18 and active = true\nname like 张\nstatus in (1,2,3) or city != 北京'
                  : DEFAULT_QUERY
              }
              className="code-textarea"
            />
            <Space className="query-actions">
              <InputNumber min={1} max={500} value={pageSize} onChange={(value) => setPageSize(value || 50)} />
              <Button type="primary" icon={<Search size={16} />} onClick={() => void load(0)}>
                查询
              </Button>
            </Space>
            <div className="query-presets">
              <Text type="secondary">常用查询</Text>
              <Space.Compact className="full-width">
                <Input
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  placeholder="方案名称"
                />
                <Button onClick={saveQueryPreset}>保存</Button>
              </Space.Compact>
              <Select
                allowClear
                className="full-width"
                placeholder="加载查询方案"
                value={undefined}
                onChange={loadQueryPreset}
                options={queryPresets.map((preset) => ({
                  value: preset.id,
                  label: `${preset.name}${preset.sortField ? ` · ${preset.sortField} ${preset.sortOrder}` : ''}`
                }))}
                notFoundContent="暂无查询方案"
              />
              {queryPresets.length > 0 && (
                <Space wrap size={[6, 6]}>
                  {queryPresets.slice(0, 6).map((preset) => (
                    <Tag
                      key={preset.id}
                      closable
                      onClose={(event) => {
                        event.preventDefault()
                        deleteQueryPreset(preset.id)
                      }}
                    >
                      {preset.name}
                    </Tag>
                  ))}
                </Space>
              )}
            </div>
            <Alert
              type="info"
              showIcon
              message="编辑提示"
              description="双击表格单元格可修改字段；对象和数组请使用 JSON 格式保存。"
            />
          </div>
        </Splitter.Panel>
        <Splitter.Panel>
          <div className="table-pane">
            <div className="sub-head">
              <Space>
                <Text strong>文档数据</Text>
                <Badge count={result.total} overflowCount={99999999} showZero color="#1677ff" />
                {typeof result.took === 'number' && <Tag>耗时 {result.took} ms</Tag>}
              </Space>
              <Space className="table-actions" wrap>
                <Select
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  className="field-filter"
                  placeholder="展示字段"
                  value={visibleFields}
                  onChange={setVisibleFields}
                  options={fieldOptions}
                />
                <Select
                  allowClear
                  showSearch
                  className="sort-field"
                  placeholder="排序字段"
                  value={sortField}
                  onChange={setSortField}
                  options={sortOptions}
                />
                <Radio.Group
                  size="small"
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as 'asc' | 'desc')}
                  options={[
                    { label: '升序', value: 'asc' },
                    { label: '降序', value: 'desc' }
                  ]}
                />
                <Button icon={<RefreshCw size={16} />} onClick={() => void load(from)}>
                  刷新数据
                </Button>
                <Button icon={<Upload size={16} />} loading={importing} onClick={() => void importDocuments()}>
                  导入
                </Button>
                <Button icon={<Download size={16} />} loading={exporting} onClick={() => void exportCurrentPage()}>
                  导出当前页
                </Button>
                <Button loading={exporting} onClick={() => void exportAllMatches()}>
                  导出查询结果
                </Button>
                <Button type="primary" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
                  新增文档
                </Button>
              </Space>
            </div>
            {operationProgress && (
              <div className="operation-progress">
                <Space direction="vertical" size={6} className="full-width">
                  <Space>
                    <Text strong>{operationProgress.type === 'import' ? '导入进度' : '导出进度'}</Text>
                    <Tag>{operationProgress.phase}</Tag>
                  </Space>
                  <Progress
                    percent={operationProgress.percent}
                    status={operationProgress.phase === 'error' ? 'exception' : operationProgress.phase === 'done' ? 'success' : 'active'}
                  />
                  <Text type="secondary">{operationProgress.message}</Text>
                </Space>
              </div>
            )}
            <Table
              rowKey="_id"
              loading={loading}
              columns={columns}
              dataSource={result.rows}
              size="small"
              scroll={{ x: Math.max(900, selectedFields.length * 180 + 440), y: 'calc(100vh - 380px)' }}
              pagination={{
                current: Math.floor(from / pageSize) + 1,
                pageSize,
                total: result.total,
                showSizeChanger: false,
                showTotal: (total, range) => `${range[0]}-${range[1]} / ${total} 条`,
                onChange: (page) => void load((page - 1) * pageSize)
              }}
            />
          </div>
        </Splitter.Panel>
      </Splitter>
      <Modal
        title="修改字段"
        open={Boolean(editingCell)}
        onCancel={() => setEditingCell(undefined)}
        width={720}
        okText="保存修改"
        cancelText="取消"
        onOk={async () => {
          if (!editingCell) return
          setSavingCell(true)
          try {
            const value = normalizeValueForOriginalType(editingValue, editingCell.originalValue)
            const response = await callApi(() =>
              api.documents.update({
                connectionId: props.connectionId,
                index: editingCell.rowIndex,
                id: editingCell.rowId,
                doc: { [editingCell.field]: value },
                refresh: true
              })
            )
            if (response.ok) {
              message.success('字段已保存')
              setEditingCell(undefined)
              await load(from)
            } else {
              message.error(resultMessage(response.error))
            }
          } catch (error) {
            message.error(error instanceof Error ? error.message : '字段保存失败')
          } finally {
            setSavingCell(false)
          }
        }}
        confirmLoading={savingCell}
      >
        <Space direction="vertical" className="full-width">
          <Alert
            type="warning"
            showIcon
            message={`正在修改字段：${editingCell?.field || ''}`}
            description="保存后会直接更新 Elasticsearch 文档。"
          />
          <Input.TextArea
            value={editingValue}
            rows={12}
            onChange={(event) => setEditingValue(event.target.value)}
            className="code-textarea"
          />
        </Space>
      </Modal>
      <DocumentCreateModal
        open={createOpen}
        connectionId={props.connectionId}
        index={props.index}
        onCancel={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false)
          await load(0)
        }}
      />
      <Modal
        title="导入文档"
        open={Boolean(pendingImport)}
        onCancel={() => {
          if (!importing) {
            setPendingImport(undefined)
          }
        }}
        onOk={() => void confirmImportDocuments()}
        okText="开始导入"
        cancelText="取消"
        confirmLoading={importing}
        width={720}
      >
        <Space direction="vertical" size={12} className="full-width">
          <Alert
            type={pendingImport?.preview.mappings ? 'info' : 'warning'}
            showIcon
            message={
              pendingImport?.preview.mappings
                ? '导入文件包含索引 mapping，可用于新建索引'
                : '导入文件未包含 mapping，只能导入到已有索引'
            }
            description="导入时会把所有文档写入你选择的目标索引，不会自动沿用文件中的原索引。"
          />
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="文件">{pendingImport?.filePath || '已选择文件'}</Descriptions.Item>
            <Descriptions.Item label="导出索引">{pendingImport?.preview.index || '未识别'}</Descriptions.Item>
            <Descriptions.Item label="文档数量">{pendingImport?.preview.documentCount || 0} 条</Descriptions.Item>
            <Descriptions.Item label="Mapping">
              {pendingImport?.preview.mappings ? '已包含' : '未包含'}
            </Descriptions.Item>
          </Descriptions>
          <Radio.Group
            value={importTargetMode}
            onChange={(event) => {
              const nextMode = event.target.value as ImportTargetMode
              setImportTargetMode(nextMode)
              setImportTargetIndex(
                nextMode === 'create'
                  ? suggestedImportIndex(pendingImport?.preview.index || props.baseIndex || props.index)
                  : hasIndexWildcard(props.index) ? props.baseIndex : props.index
              )
            }}
            options={[
              { label: '导入到已有索引', value: 'existing' },
              { label: '新建索引并使用导出 mapping', value: 'create', disabled: !pendingImport?.preview.mappings }
            ]}
          />
          <Space direction="vertical" size={6} className="full-width">
            <Text type="secondary">{importTargetMode === 'create' ? '新索引名称' : '已有索引名称'}</Text>
            <Input
              value={importTargetIndex}
              onChange={(event) => setImportTargetIndex(event.target.value)}
              placeholder={importTargetMode === 'create' ? '例如：orders_copy' : '例如：orders'}
            />
            <Text type="secondary">
              {importTargetMode === 'create'
                ? '会先创建这个索引并应用导出文件中的 mapping，然后导入数据。'
                : '会复用已有索引和 mapping，只导入文档数据。'}
            </Text>
          </Space>
        </Space>
      </Modal>
      <Modal
        title={`文档详情：${detailRow?._id || ''}`}
        open={Boolean(detailRow)}
        onCancel={() => setDetailRow(undefined)}
        width={860}
        okText="保存整条数据"
        cancelText="关闭"
        confirmLoading={savingDetail}
        onOk={async () => {
          if (!detailRow) return
          setSavingDetail(true)
          try {
            const doc = parseJson(detailText)
            const response = await callApi(() =>
              api.documents.update({
                connectionId: props.connectionId,
                index: detailRow._index || props.index,
                id: detailRow._id,
                doc,
                refresh: true
              })
            )
            if (response.ok) {
              message.success('整条数据已保存')
              setDetailRow(undefined)
              await load(from)
            } else {
              message.error(resultMessage(response.error))
            }
          } catch (error) {
            message.error(error instanceof Error ? error.message : '整条数据保存失败')
          } finally {
            setSavingDetail(false)
          }
        }}
      >
        <Input.TextArea
          value={detailText}
          rows={24}
          onChange={(event) => setDetailText(event.target.value)}
          className="code-textarea large-code"
        />
      </Modal>
    </div>
  )
}

function AggregationPanel(props: {
  connectionId: string
  index: string
  baseIndex: string
  targetIndex: string
  onTargetIndexChange: (value: string) => void
}): JSX.Element {
  const { message } = AntApp.useApp()
  const { queryMode, setQueryMode, queryText, handleQueryTextChange, resetQuery } = useSyncedQueryState()
  const [fields, setFields] = useState<MappingField[]>([])
  const [loadingFields, setLoadingFields] = useState(false)
  const [groupFields, setGroupFields] = useState<string[]>([])
  const [metric, setMetric] = useState<AggregationMetric>('count')
  const [metricField, setMetricField] = useState<string>()
  const [size, setSize] = useState(100)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DocumentAggregationResult>()

  const groupOptions = useMemo(
    () =>
      fields
        .filter((field) => field.aggregatablePath)
        .map((field) => ({
          value: field.aggregatablePath || field.path,
          label:
            field.aggregatablePath && field.aggregatablePath !== field.path
              ? `${field.path} (${field.aggregatablePath})`
              : `${field.path} (${field.type})`
        })),
    [fields]
  )
  const metricOptions = useMemo(
    () =>
      fields
        .filter((field) => field.metricCapable)
        .map((field) => ({
          value: field.path,
          label: `${field.path} (${field.type})`
        })),
    [fields]
  )

  const loadFields = async (): Promise<void> => {
    if (hasIndexWildcard(props.index)) {
      setFields([])
      setGroupFields([])
      setMetricField(undefined)
      return
    }

    setLoadingFields(true)
    try {
      const response = await callApi(() =>
        api.indices.mapping({ connectionId: props.connectionId, index: props.index })
      )
      if (response.ok) {
        const nextFields = extractMappingFields(response.data, props.index)
        const firstGroupField = nextFields.find((field) => field.aggregatablePath)?.aggregatablePath
        setFields(nextFields)
        setGroupFields((current) =>
          current.length && current.every((selected) => nextFields.some((field) => field.aggregatablePath === selected))
            ? current
            : firstGroupField
              ? [firstGroupField]
              : []
        )
        setMetricField((current) =>
          current && nextFields.some((field) => field.path === current && field.metricCapable)
            ? current
            : nextFields.find((field) => field.metricCapable)?.path
        )
      } else {
        message.error(resultMessage(response.error))
      }
    } finally {
      setLoadingFields(false)
    }
  }

  useEffect(() => {
    void loadFields()
    setResult(undefined)
  }, [props.connectionId, props.index])

  const runAggregation = async (): Promise<void> => {
    if (!groupFields.length) {
      message.error('请选择分组字段')
      return
    }

    if (metric !== 'count' && !metricField) {
      message.error('请选择指标字段')
      return
    }

    setLoading(true)
    try {
      const response = await callApi(() =>
        api.documents.aggregate({
          connectionId: props.connectionId,
          index: props.index,
          queryText,
          groupFields,
          metric,
          metricField: metric === 'count' ? undefined : metricField,
          size
        })
      )

      if (response.ok) {
        setResult(response.data)
      } else {
        message.error(resultMessage(response.error))
      }
    } finally {
      setLoading(false)
    }
  }

  const columns: ColumnsType<DocumentAggregationResult['buckets'][number]> = [
    ...(result?.groupFields.length ? result.groupFields : groupFields).map((field, index) => ({
      title: field,
      key: `group-${field}-${index}`,
      width: 180,
      render: (_: unknown, row: DocumentAggregationResult['buckets'][number]) => {
        const value = row.keys[index]
        return value === null ? <Text type="secondary">空值</Text> : String(value ?? '')
      }
    })),
    {
      title: '文档数',
      dataIndex: 'count',
      width: 140,
      sorter: (a, b) => a.count - b.count
    }
  ]

  if (metric !== 'count') {
    columns.push({
      title: `${metric.toUpperCase()}(${metricField || '-'})`,
      dataIndex: 'value',
      width: 180,
      sorter: (a, b) => (a.value || 0) - (b.value || 0),
      render: (value?: number | null) => (typeof value === 'number' ? Number(value.toFixed(6)) : '-')
    })
  }

  return (
    <div className="sub-panel">
      <Splitter>
        <Splitter.Panel defaultSize={360} min={300} max={520}>
          <div className="query-pane">
            <div className="sub-head">
              <Text strong>聚合条件</Text>
              <Space>
                <Radio.Group
                  size="small"
                  value={queryMode}
                  onChange={(event) => {
                    setQueryMode(event.target.value as QueryMode)
                  }}
                  options={[
                    { label: '条件', value: 'condition' },
                    { label: 'DSL', value: 'dsl' }
                  ]}
                />
                <Button
                  size="small"
                  onClick={resetQuery}
                >
                  重置
                </Button>
              </Space>
            </div>
            <Space direction="vertical" size={12} className="full-width">
              <Space direction="vertical" size={6} className="full-width">
                <Text type="secondary">目标索引</Text>
                <Space.Compact className="full-width">
                  <Input
                    value={props.targetIndex}
                    onChange={(event) => props.onTargetIndexChange(event.target.value)}
                    placeholder="查询目标索引，例如 index*"
                  />
                  <Button onClick={() => props.onTargetIndexChange(props.baseIndex)}>恢复</Button>
                </Space.Compact>
              </Space>
              <Input.TextArea
                value={queryText}
                rows={queryMode === 'condition' ? 5 : 12}
                onChange={(event) => handleQueryTextChange(event.target.value)}
                placeholder={
                  queryMode === 'condition'
                    ? '例如：age >= 18 and active = true'
                    : DEFAULT_QUERY
                }
                className="code-textarea"
              />
              <Spin spinning={loadingFields}>
                <Space direction="vertical" size={10} className="full-width aggregation-form">
                  <div>
                    <Text type="secondary">分组字段</Text>
                    <Select
                      mode={hasIndexWildcard(props.index) ? 'tags' : 'multiple'}
                      showSearch
                      maxTagCount="responsive"
                      className="full-width"
                      placeholder={hasIndexWildcard(props.index) ? '通配索引请手动输入多个字段' : '选择一个或多个分组字段'}
                      value={groupFields}
                      onChange={(value) => setGroupFields(value.slice(0, 5))}
                      options={groupOptions}
                      notFoundContent={hasIndexWildcard(props.index) ? '输入字段名后回车' : '没有可聚合字段'}
                    />
                  </div>
                  <div>
                    <Text type="secondary">指标</Text>
                    <Select
                      className="full-width"
                      value={metric}
                      onChange={(value) => setMetric(value)}
                      options={[
                        { value: 'count', label: 'count 文档数' },
                        { value: 'sum', label: 'sum 求和' },
                        { value: 'avg', label: 'avg 平均值' },
                        { value: 'min', label: 'min 最小值' },
                        { value: 'max', label: 'max 最大值' }
                      ]}
                    />
                  </div>
                  {metric !== 'count' && (
                    <div>
                      <Text type="secondary">指标字段</Text>
                      <Select
                        mode={hasIndexWildcard(props.index) ? 'combobox' : undefined}
                        showSearch
                        className="full-width"
                        placeholder={hasIndexWildcard(props.index) ? '通配索引请手动输入数值字段' : '选择数值字段'}
                        value={metricField}
                        onChange={setMetricField}
                        options={metricOptions}
                        notFoundContent="没有数值字段"
                      />
                    </div>
                  )}
                  <Space className="query-actions">
                    <InputNumber min={1} max={1000} value={size} onChange={(value) => setSize(value || 100)} />
                    <Button type="primary" icon={<ChartColumn size={16} />} loading={loading} onClick={() => void runAggregation()}>
                      运行聚合
                    </Button>
                  </Space>
                </Space>
              </Spin>
            </Space>
          </div>
        </Splitter.Panel>
        <Splitter.Panel>
          <div className="table-pane">
            <div className="sub-head">
              <Space>
                <Text strong>聚合结果</Text>
                {result && <Badge count={result.buckets.length} overflowCount={9999} showZero color="#1677ff" />}
                {result && <Tag>命中 {result.total} 条</Tag>}
                {typeof result?.took === 'number' && <Tag>耗时 {result.took} ms</Tag>}
              </Space>
              <Button icon={<RefreshCw size={16} />} loading={loading} onClick={() => void runAggregation()}>
                刷新聚合
              </Button>
            </div>
            <Table
              rowKey={(row) => JSON.stringify(row.keys)}
              loading={loading}
              columns={columns}
              dataSource={result?.buckets || []}
              size="small"
              pagination={{ pageSize: 20, showSizeChanger: true }}
            />
          </div>
        </Splitter.Panel>
      </Splitter>
    </div>
  )
}

function DocumentCreateModal(props: {
  open: boolean
  connectionId: string
  index: string
  onCancel: () => void
  onCreated: () => Promise<void>
}): JSX.Element {
  const { message } = AntApp.useApp()
  const [id, setId] = useState('')
  const [body, setBody] = useState('{\n  "name": "示例文档"\n}')
  const [fields, setFields] = useState<MappingField[]>([])
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [loadingFields, setLoadingFields] = useState(false)
  const [saving, setSaving] = useState(false)
  const useFieldForm = fields.length > 0 && !hasIndexWildcard(props.index)

  useEffect(() => {
    if (!props.open) {
      return
    }

    setId('')
    setBody('{\n  "name": "示例文档"\n}')
    setFields([])
    setFieldValues({})

    if (hasIndexWildcard(props.index)) {
      return
    }

    const loadFields = async (): Promise<void> => {
      setLoadingFields(true)
      try {
        const response = await callApi(() =>
          api.indices.mapping({ connectionId: props.connectionId, index: props.index })
        )
        if (response.ok) {
          const nextFields = extractMappingFields(response.data, props.index)
          setFields(nextFields)
          setFieldValues(
            Object.fromEntries(
              nextFields.map((field) => [field.path, field.input === 'json' ? '' : ''])
            )
          )
        } else {
          message.warning(`读取字段失败，将使用 JSON 输入：${resultMessage(response.error)}`)
        }
      } finally {
        setLoadingFields(false)
      }
    }

    void loadFields()
  }, [props.open, props.connectionId, props.index, message])

  const buildDocumentFromFields = (): Record<string, unknown> => {
    const document: Record<string, unknown> = {}

    fields.forEach((field) => {
      const value = parseMappingFieldValue(field, fieldValues[field.path] || '')
      if (value !== undefined) {
        setNestedDocumentValue(document, field.path, value)
      }
    })

    return document
  }

  return (
    <Modal
      title="新增文档"
      open={props.open}
      onCancel={props.onCancel}
      okText="创建"
      cancelText="取消"
      confirmLoading={saving}
      width={720}
      onOk={async () => {
        setSaving(true)
        try {
          const document = useFieldForm ? buildDocumentFromFields() : parseJson(body)
          if (!Object.keys(document).length) {
            throw new Error('请至少填写一个字段值')
          }

          const response = await callApi(() =>
            api.documents.create({
              connectionId: props.connectionId,
              index: props.index,
              id,
              document,
              refresh: true
            })
          )
          if (response.ok) {
            message.success('文档已创建')
            await props.onCreated()
          } else {
            message.error(resultMessage(response.error))
          }
        } catch (error) {
          message.error(error instanceof Error ? error.message : '文档创建失败')
        } finally {
          setSaving(false)
        }
      }}
    >
      <Space direction="vertical" className="full-width">
        <Input value={id} onChange={(event) => setId(event.target.value)} placeholder="文档 ID（可选）" />
        {useFieldForm ? (
          <Spin spinning={loadingFields}>
            <div className="document-create-fields">
              {fields.map((field) => (
                <div className="document-create-field" key={field.path}>
                  <div className="document-create-label">
                    <Text strong>{field.path}</Text>
                    <Tag>{field.type}</Tag>
                  </div>
                  {field.input === 'boolean' ? (
                    <Select
                      allowClear
                      placeholder="请选择"
                      value={fieldValues[field.path] || undefined}
                      onChange={(value) =>
                        setFieldValues((current) => ({
                          ...current,
                          [field.path]: value || ''
                        }))
                      }
                      options={[
                        { value: 'true', label: 'true' },
                        { value: 'false', label: 'false' }
                      ]}
                    />
                  ) : field.input === 'json' ? (
                    <Input.TextArea
                      value={fieldValues[field.path] || ''}
                      rows={4}
                      onChange={(event) =>
                        setFieldValues((current) => ({
                          ...current,
                          [field.path]: event.target.value
                        }))
                      }
                      placeholder={field.type === 'nested' ? '[{}]' : '{}'}
                      className="code-textarea"
                    />
                  ) : (
                    <Input
                      value={fieldValues[field.path] || ''}
                      type={field.input === 'number' ? 'number' : 'text'}
                      onChange={(event) =>
                        setFieldValues((current) => ({
                          ...current,
                          [field.path]: event.target.value
                        }))
                      }
                      placeholder={field.input === 'number' ? '数字' : '字段值'}
                    />
                  )}
                </div>
              ))}
            </div>
          </Spin>
        ) : (
          <Input.TextArea
            value={body}
            rows={14}
            onChange={(event) => setBody(event.target.value)}
            className="code-textarea"
          />
        )}
      </Space>
    </Modal>
  )
}

function MappingPanel(props: {
  connectionId: string
  index: string
  baseIndex: string
  targetIndex: string
  onTargetIndexChange: (value: string) => void
  onRefresh: () => void
}): JSX.Element {
  const { message } = AntApp.useApp()
  const [mappingText, setMappingText] = useState('{}')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const response = await callApi(() =>
        api.indices.mapping({ connectionId: props.connectionId, index: props.index })
      )
      if (response.ok) setMappingText(formatJson(response.data))
      else message.error(resultMessage(response.error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [props.connectionId, props.index])

  return (
    <div className="sub-panel">
      <Alert
        className="mapping-alert"
        type="info"
        showIcon
        message="映射编辑说明"
        description={
          hasIndexWildcard(props.index)
            ? '当前目标索引包含通配符或多个索引，仅支持查看映射；保存映射请切回单个索引。'
            : 'Elasticsearch 允许新增字段和部分安全参数；已有字段类型变更通常需要新建索引并 reindex。'
        }
      />
      <div className="sub-head">
        <Space direction="vertical" size={6} className="mapping-index-group">
          <Text strong>Mapping JSON</Text>
          <Space.Compact className="mapping-index-control">
            <Input
              value={props.targetIndex}
              onChange={(event) => props.onTargetIndexChange(event.target.value)}
              placeholder="目标索引，例如 index*"
            />
            <Button onClick={() => props.onTargetIndexChange(props.baseIndex)}>恢复</Button>
          </Space.Compact>
        </Space>
        <Space>
          <Button icon={<RefreshCw size={16} />} onClick={() => void load()}>
            重新加载
          </Button>
          <Button
            type="primary"
            icon={<Save size={16} />}
            loading={saving}
            disabled={hasIndexWildcard(props.index)}
            onClick={async () => {
              setSaving(true)
              try {
                if (hasIndexWildcard(props.index)) {
                  throw new Error('当前目标包含通配符或多个索引，请切回单个索引后再保存映射')
                }
                const parsed = parseJson(mappingText)
                const indexMapping = parsed[props.index] as { mappings?: Record<string, unknown> } | undefined
                const body = indexMapping?.mappings || parsed
                const response = await callApi(() =>
                  api.indices.putMapping({
                    connectionId: props.connectionId,
                    index: props.index,
                    body
                  })
                )
                if (response.ok) {
                  message.success('映射已保存')
                  props.onRefresh()
                } else {
                  message.error(resultMessage(response.error))
                }
              } catch (error) {
                message.error(error instanceof Error ? error.message : '映射保存失败')
              } finally {
                setSaving(false)
              }
            }}
          >
            保存映射
          </Button>
        </Space>
      </div>
      <Spin spinning={loading}>
        <Input.TextArea
          value={mappingText}
          rows={24}
          onChange={(event) => setMappingText(event.target.value)}
          className="code-textarea large-code"
        />
      </Spin>
    </div>
  )
}

function TemplatesPanel(props: {
  connectionId: string
  onOpenTemplate: (
    connectionId: string,
    name: string,
    templateType: 'index_template' | 'legacy_template'
  ) => void
  onRefresh: () => void
}): JSX.Element {
  const { message } = AntApp.useApp()
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const response = await callApi(() => api.templates.list(props.connectionId))
      if (response.ok) setTemplates(response.data)
      else message.error(resultMessage(response.error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [props.connectionId])

  const columns: ColumnsType<TemplateSummary> = [
    {
      title: '模板名称',
      dataIndex: 'name',
      render: (value: string, row) => (
        <Button
          type="link"
          className="link-button"
          onClick={() => props.onOpenTemplate(props.connectionId, value, row.type)}
        >
          {value}
        </Button>
      )
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 150,
      render: (value: TemplateSummary['type']) => (value === 'index_template' ? '组合模板' : '旧版模板')
    },
    {
      title: '匹配模式',
      dataIndex: 'indexPatterns',
      render: (value?: string[]) => value?.join(', ') || '-'
    },
    { title: '优先级', dataIndex: 'priority', width: 100, render: (value?: number) => value ?? '-' },
    { title: '版本', dataIndex: 'version', width: 100, render: (value?: number) => value ?? '-' },
    {
      title: '操作',
      width: 180,
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => props.onOpenTemplate(props.connectionId, row.name, row.type)}>
            查看
          </Button>
          <Popconfirm
            title="确认删除模板？"
            description={`将删除模板 ${row.name}`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              const response = await callApi(() =>
                api.templates.delete({
                  connectionId: props.connectionId,
                  name: row.name,
                  type: row.type
                })
              )
              if (response.ok) {
                message.success('模板已删除')
                await load()
                props.onRefresh()
              } else {
                message.error(resultMessage(response.error))
              }
            }}
          >
            <Button size="small" danger icon={<Trash2 size={14} />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <Title level={4}>模板</Title>
          <Text type="secondary">查看、新建、修改和删除索引模板。</Text>
        </div>
        <Space>
          <Button icon={<RefreshCw size={16} />} onClick={() => void load()}>
            刷新
          </Button>
          <Button type="primary" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
            新建模板
          </Button>
        </Space>
      </div>
      <Table rowKey={(row) => `${row.type}:${row.name}`} loading={loading} columns={columns} dataSource={templates} />
      <TemplateEditModal
        open={createOpen}
        connectionId={props.connectionId}
        onCancel={() => setCreateOpen(false)}
        onSaved={async () => {
          setCreateOpen(false)
          await load()
          props.onRefresh()
        }}
      />
    </section>
  )
}

function TemplateDetailPanel(props: {
  connectionId: string
  name: string
  templateType: 'index_template' | 'legacy_template'
  onRefresh: () => void
}): JSX.Element {
  const { message } = AntApp.useApp()
  const [body, setBody] = useState('{}')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const response = await callApi(() =>
        api.templates.get({
          connectionId: props.connectionId,
          name: props.name,
          type: props.templateType
        })
      )
      if (response.ok) setBody(formatJson(response.data))
      else message.error(resultMessage(response.error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [props.connectionId, props.name, props.templateType])

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <Title level={4}>{props.name}</Title>
          <Text type="secondary">{props.templateType === 'index_template' ? '组合模板' : '旧版模板'}</Text>
        </div>
        <Space>
          <Button icon={<RefreshCw size={16} />} onClick={() => void load()}>
            重新加载
          </Button>
          <Button
            type="primary"
            icon={<Save size={16} />}
            loading={saving}
            onClick={async () => {
              setSaving(true)
              try {
                const parsed = parseJson(body)
                const payloadBody =
                  props.templateType === 'index_template' &&
                  Array.isArray((parsed as { index_templates?: unknown[] }).index_templates)
                    ? (((parsed as { index_templates: Array<{ index_template?: Record<string, unknown> }> })
                        .index_templates[0]?.index_template || {}) as Record<string, unknown>)
                    : parsed

                const response = await callApi(() =>
                  api.templates.put({
                    connectionId: props.connectionId,
                    name: props.name,
                    type: props.templateType,
                    body: payloadBody
                  })
                )
                if (response.ok) {
                  message.success('模板已保存')
                  props.onRefresh()
                } else {
                  message.error(resultMessage(response.error))
                }
              } catch (error) {
                message.error(error instanceof Error ? error.message : '模板保存失败')
              } finally {
                setSaving(false)
              }
            }}
          >
            保存模板
          </Button>
        </Space>
      </div>
      <Spin spinning={loading}>
        <Input.TextArea
          value={body}
          rows={28}
          onChange={(event) => setBody(event.target.value)}
          className="code-textarea large-code"
        />
      </Spin>
    </section>
  )
}

function TemplateEditModal(props: {
  open: boolean
  connectionId: string
  onCancel: () => void
  onSaved: () => Promise<void>
}): JSX.Element {
  const { message } = AntApp.useApp()
  const [name, setName] = useState('')
  const [type, setType] = useState<'index_template' | 'legacy_template'>('index_template')
  const [body, setBody] = useState(DEFAULT_TEMPLATE_BODY)
  const [saving, setSaving] = useState(false)

  return (
    <Modal
      title="新建模板"
      open={props.open}
      onCancel={props.onCancel}
      okText="保存"
      cancelText="取消"
      width={760}
      confirmLoading={saving}
      onOk={async () => {
        setSaving(true)
        try {
          if (!name.trim()) {
            throw new Error('请输入模板名称')
          }
          const response = await callApi(() =>
            api.templates.put({
              connectionId: props.connectionId,
              name: name.trim(),
              type,
              body: parseJson(body)
            })
          )
          if (response.ok) {
            message.success('模板已保存')
            await props.onSaved()
          } else {
            message.error(resultMessage(response.error))
          }
        } catch (error) {
          message.error(error instanceof Error ? error.message : '模板保存失败')
        } finally {
          setSaving(false)
        }
      }}
    >
      <Space direction="vertical" className="full-width">
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="模板名称" />
        <Radio.Group
          value={type}
          onChange={(event) => setType(event.target.value as 'index_template' | 'legacy_template')}
          options={[
            { label: '组合模板', value: 'index_template' },
            { label: '旧版模板', value: 'legacy_template' }
          ]}
        />
        <Input.TextArea
          value={body}
          rows={14}
          onChange={(event) => setBody(event.target.value)}
          className="code-textarea"
        />
      </Space>
    </Modal>
  )
}

const authTypeLabel = (type: AuthType): string => {
  if (type === 'basic') return 'Basic Auth'
  if (type === 'apiKey') return 'API Key'
  return '无认证'
}

const healthColor = (value: string): string => {
  if (value === 'green') return 'green'
  if (value === 'yellow') return 'gold'
  if (value === 'red') return 'red'
  return 'default'
}

export default App
