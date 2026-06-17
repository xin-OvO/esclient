# ESClient

ESClient 是一个基于 Electron、React 和 TypeScript 构建的 Elasticsearch 桌面客户端。它面向日常开发、测试和内部运维场景，提供连接管理、索引浏览、文档查询、数据编辑、导入导出和轻量聚合等能力。

它不是 Kibana 的替代品，而是一个更轻量的桌面工具：当你只是想快速查看索引、查几条数据、改一个字段、导入导出一批 JSON 或做一次简单分组统计时，ESClient 会更直接。

## 功能特性

- 连接管理：支持无认证、Basic Auth 和 API Key。
- 集群信息：查看集群健康状态、版本、节点和集群设置。
- 索引管理：浏览索引列表，查看索引详情和 mapping。
- 文档查询：支持条件查询和原生 Elasticsearch DSL。
- 条件转 DSL：修改条件查询时自动同步 DSL。
- 深分页：支持超过 Elasticsearch 默认 10,000 条窗口的数据翻页。
- 表格能力：字段展示过滤、排序、分页和每个索引的偏好保存。
- 文档编辑：新增、修改、删除文档；双击单元格可快速编辑字段。
- 自动表单：新增文档时根据 mapping 自动展示字段，只需要填写字段值。
- 导入导出：JSON 导入导出带进度条和完成结果提示。
- Mapping 导出：导出数据时同步导出索引 mapping。
- Mapping 导入：导入时可选择复用已有索引，或用导出文件中的 mapping 新建索引后导入。
- 分组聚合：支持多字段 terms 聚合，以及 count、sum、avg、min、max 指标。
- 查询方案：常用查询可按连接和索引保存到本地。
- 跨平台打包：通过 electron-builder 生成 macOS、Windows 和 Linux 包。

## 使用场景

- 快速连接本地或测试环境 Elasticsearch。
- 查看索引结构、mapping 和文档数据。
- 用简单条件查询数据，同时保留可编辑的 DSL。
- 对少量文档做人工修正。
- 在不同环境之间导出、导入 JSON 数据。
- 将索引 mapping 和数据一起备份，之后恢复到新索引。
- 对数据做临时分组统计。

## 技术栈

- Electron
- React
- TypeScript
- Ant Design
- Elasticsearch JavaScript Client
- electron-builder

## 开发运行

环境要求：

- Node.js 20+
- pnpm

安装依赖：

```bash
pnpm install
```

启动开发环境：

```bash
pnpm dev
```

构建生产产物：

```bash
pnpm build
```

构建结果会输出到 `out/` 目录。

## 打包

使用 electron-builder 打包：

```bash
pnpm dist
```

默认打包输出目录为 `release/`。

本项目不包含代码签名证书。未签名包适合本地测试或小范围内部使用，但 macOS 和 Windows 首次打开时可能出现安全提示。如果要公开分发，建议使用正式的 Apple Developer ID 签名和公证，以及 Windows 代码签名证书。

## 本地 Elasticsearch

可以用 Docker 启动一个单节点 Elasticsearch 作为开发测试环境：

```bash
docker run -d --name esclient-test-es -p 9200:9200 \
  -e discovery.type=single-node \
  -e xpack.security.enabled=false \
  -e ES_JAVA_OPTS='-Xms512m -Xmx512m' \
  docker.elastic.co/elasticsearch/elasticsearch:8.19.1
```

然后在 ESClient 中创建连接：

```text
地址：http://localhost:9200
认证：无认证
```

## 导入导出格式

ESClient 导出的 JSON 会同时包含数据和索引 mapping：

```json
{
  "index": "example-index",
  "exportedAt": "2026-06-17T00:00:00.000Z",
  "total": 1,
  "exported": 1,
  "mappings": {
    "example-index": {
      "mappings": {
        "properties": {
          "name": { "type": "keyword" }
        }
      }
    }
  },
  "documents": [
    {
      "id": "1",
      "index": "example-index",
      "document": {
        "name": "Alice"
      }
    }
  ]
}
```

导入时可以选择两种模式：

- 导入到已有索引：复用目标索引的已有 mapping，只写入文档数据。
- 新建索引并使用导出 mapping：先用导出文件中的 mapping 创建索引，再导入文档数据。

为了避免误写入，导入时所有文档都会写入你选择的目标索引，不会自动沿用导出文件里的原索引。

旧格式的 JSON 数组、单个 JSON 对象、JSONL 和简单 Elasticsearch bulk 风格文件仍然可以作为文档数据导入。

## 常用命令

```bash
pnpm lint
pnpm build
pnpm dev
pnpm dist
```

构建脚本会自动生成应用图标：

```bash
node scripts/generate-icons.mjs
```

## 安全提示

ESClient 可以写入、修改和删除 Elasticsearch 中的数据。建议在测试环境或权限受限的账号下使用。对生产集群执行导入、删除或修改前，请确认目标连接、目标索引和导入模式。

## License

MIT License. See [LICENSE](LICENSE) for details.
