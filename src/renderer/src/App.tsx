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
import Menu from 'antd/es/menu'
import Modal from 'antd/es/modal'
import Popconfirm from 'antd/es/popconfirm'
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
  ChevronLeft,
  ChevronRight,
  Database,
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
  Eye
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type {
  AuthType,
  ClusterHealth,
  ConnectionInfo,
  ConnectionInput,
  ConnectionProfile,
  DocumentRow,
  DocumentSearchResult,
  IndexSummary,
  TemplateSummary
} from '../../shared/types'

const { Header, Sider, Content } = Layout
const { Text, Title } = Typography
const DEFAULT_QUERY = '{\n  "query": {\n    "match_all": {}\n  }\n}'
const DEFAULT_CONDITION_QUERY = ''
const DEFAULT_INDEX_BODY = '{\n  "settings": {},\n  "mappings": {\n    "properties": {}\n  }\n}'
const DEFAULT_TEMPLATE_BODY =
  '{\n  "index_patterns": ["logs-*"],\n  "template": {\n    "settings": {},\n    "mappings": {\n      "properties": {}\n    }\n  }\n}'

type WorkspaceView =
  | { type: 'welcome' }
  | { type: 'connection'; connectionId: string }
  | { type: 'cluster'; connectionId: string }
  | { type: 'indices'; connectionId: string }
  | { type: 'index'; connectionId: string; index: string; section: 'data' | 'mapping' }
  | { type: 'templates'; connectionId: string }
  | { type: 'template'; connectionId: string; name: string; templateType: 'index_template' | 'legacy_template' }

interface EditableCell {
  rowId: string
  rowIndex: string
  field: string
  originalValue?: unknown
}

const api = window.esClient

const callApi = async <T,>(operation: () => Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>) => {
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

const parseJson = (value: string): Record<string, unknown> => {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请输入 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

const resultMessage = (error: { message: string } | undefined): string => {
  return error?.message || '操作失败'
}

const hasIndexWildcard = (index: string): boolean => /[*?,]/.test(index)

const getSourceValue = (row: DocumentRow, field: string): unknown => row._source[field]

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
          <Menu
            className="main-menu"
            mode="horizontal"
            selectable={false}
            items={[
              { key: 'file', label: '文件' },
              { key: 'edit', label: '编辑' },
              { key: 'view', label: '视图' },
              { key: 'connection', label: '连接' },
              { key: 'index', label: '索引' },
              { key: 'tools', label: '工具' },
              { key: 'help', label: '帮助' }
            ]}
          />
          <Space className="toolbar">
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
              onOpenTemplate={(connectionId, name, templateType) =>
                setView({ type: 'template', connectionId, name, templateType })
              }
              onRefresh={refreshResources}
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
  onOpenIndex: (connectionId: string, index: string, section?: 'data' | 'mapping') => void
  onOpenTemplate: (
    connectionId: string,
    name: string,
    templateType: 'index_template' | 'legacy_template'
  ) => void
  onRefresh: () => void
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
      />
    )
  }

  if (view.type === 'index') {
    return (
      <IndexDetailPanel
        connectionId={view.connectionId}
        index={view.index}
        section={view.section}
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
  onOpenIndex: (connectionId: string, index: string, section?: 'data' | 'mapping') => void
  onRefresh: () => void
}): JSX.Element {
  const { message } = AntApp.useApp()
  const [indices, setIndices] = useState<IndexSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [indexFilter, setIndexFilter] = useState('')

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
    const keyword = indexFilter.trim().toLowerCase()
    if (!keyword) return indices

    const pattern = keyword.includes('*')
      ? new RegExp(`^${keyword.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
      : undefined

    return indices.filter((item) => {
      const name = item.index.toLowerCase()
      return pattern ? pattern.test(name) : name.includes(keyword)
    })
  }, [indices, indexFilter])

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
            value={indexFilter}
            onChange={(event) => setIndexFilter(event.target.value)}
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
  section: 'data' | 'mapping'
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
        <div>
          <Title level={4}>{props.index}</Title>
          <Text type="secondary">索引数据和映射管理。</Text>
        </div>
        <Space>
          <Input
            value={targetIndex}
            onChange={(event) => setTargetIndex(event.target.value)}
            placeholder="查询目标索引，例如 index*"
            className="rename-input"
          />
          <Button onClick={() => setTargetIndex(props.index)}>恢复当前索引</Button>
        </Space>
      </div>
      <Tabs
        activeKey={active}
        onChange={(key) => setActive(key as 'data' | 'mapping')}
        items={[
          {
            key: 'data',
            label: (
              <Space size={6}>
                <Table2 size={15} />
                数据
              </Space>
            ),
            children: <DocumentsPanel connectionId={props.connectionId} index={targetIndex.trim() || props.index} />
          },
          {
            key: 'mapping',
            label: (
              <Space size={6}>
                <Braces size={15} />
                映射
              </Space>
            ),
            children: <MappingPanel connectionId={props.connectionId} index={targetIndex.trim() || props.index} onRefresh={props.onRefresh} />
          }
        ]}
      />
    </section>
  )
}

function DocumentsPanel(props: { connectionId: string; index: string }): JSX.Element {
  const { message } = AntApp.useApp()
  const [queryMode, setQueryMode] = useState<'condition' | 'dsl'>('condition')
  const [queryText, setQueryText] = useState(DEFAULT_CONDITION_QUERY)
  const [pageSize, setPageSize] = useState(50)
  const [from, setFrom] = useState(0)
  const [result, setResult] = useState<DocumentSearchResult>({ rows: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [editingCell, setEditingCell] = useState<EditableCell>()
  const [editingValue, setEditingValue] = useState('')
  const [savingCell, setSavingCell] = useState(false)
  const [detailRow, setDetailRow] = useState<DocumentRow>()
  const [detailText, setDetailText] = useState('')
  const [savingDetail, setSavingDetail] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const load = async (nextFrom = from): Promise<void> => {
    setLoading(true)
    try {
      const response = await callApi(() =>
        api.documents.search({
          connectionId: props.connectionId,
          index: props.index,
          queryText,
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
    void load(0)
  }, [props.connectionId, props.index])

  const fields = useMemo(() => {
    const fieldSet = new Set<string>()
    result.rows.forEach((row) => Object.keys(row._source || {}).forEach((field) => fieldSet.add(field)))
    return Array.from(fieldSet).slice(0, 80)
  }, [result.rows])

  const columns: ColumnsType<DocumentRow> = [
    { title: '_id', dataIndex: '_id', width: 260, fixed: 'left' },
    { title: '_index', dataIndex: '_index', width: 180 },
    ...fields.map((field) => ({
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
                    const mode = event.target.value as 'condition' | 'dsl'
                    setQueryMode(mode)
                    setQueryText(mode === 'condition' ? DEFAULT_CONDITION_QUERY : DEFAULT_QUERY)
                  }}
                  options={[
                    { label: '条件', value: 'condition' },
                    { label: 'DSL', value: 'dsl' }
                  ]}
                />
                <Button
                  size="small"
                  onClick={() => setQueryText(queryMode === 'condition' ? DEFAULT_CONDITION_QUERY : DEFAULT_QUERY)}
                >
                  重置
                </Button>
              </Space>
            </div>
            <Input.TextArea
              value={queryText}
              rows={queryMode === 'condition' ? 5 : 16}
              onChange={(event) => setQueryText(event.target.value)}
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
              <Space>
                <Button icon={<RefreshCw size={16} />} onClick={() => void load(from)}>
                  刷新数据
                </Button>
                <Button type="primary" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
                  新增文档
                </Button>
              </Space>
            </div>
            <Table
              rowKey="_id"
              loading={loading}
              columns={columns}
              dataSource={result.rows}
              size="small"
              scroll={{ x: Math.max(900, fields.length * 180 + 440), y: 'calc(100vh - 360px)' }}
              pagination={{
                current: Math.floor(from / pageSize) + 1,
                pageSize,
                total: result.total,
                showSizeChanger: false,
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
  const [saving, setSaving] = useState(false)

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
            const response = await callApi(() =>
              api.documents.create({
                connectionId: props.connectionId,
                index: props.index,
                id,
                document: parseJson(body),
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

function MappingPanel(props: { connectionId: string; index: string; onRefresh: () => void }): JSX.Element {
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
        <Text strong>Mapping JSON</Text>
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
