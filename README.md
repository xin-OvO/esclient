# ES 中文客户端

一个类似 Navicat 的 Elasticsearch 中文桌面客户端，基于 Electron + React + TypeScript。

## 第一版功能

- 连接管理：新建、编辑、删除、测试连接。
- 连接信息：查看集群名称、集群 UUID、ES 版本和连接配置。
- 集群信息：查看集群健康状态和集群设置。
- 索引管理：查看索引列表、新建索引、删除索引、查看数据、查看/保存 Mapping。
- 文档数据：查询文档、新增文档、双击单元格修改字段、删除文档。
- 模板管理：查看模板列表、新建模板、查看模板 JSON、保存模板、删除模板。
- UI 文案：界面菜单、按钮、表单、弹窗和提示均为中文。

## 开发运行

```bash
pnpm install
pnpm dev
```

如果 Electron 二进制下载较慢，可以使用镜像重新跑安装脚本：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/.pnpm/electron@39.8.10/node_modules/electron/install.js
```

## 构建验证

```bash
pnpm build
```

构建产物输出到 `out/`。

## 打包分发

macOS Apple Silicon 当前已验证的分发包：

```text
release/ES中文客户端-0.1.0-arm64.zip
```

把这个 zip 发给 Apple Silicon Mac 用户，对方解压后双击 `ES中文客户端.app` 即可打开。如果 macOS 提示来自未知开发者，需要在系统设置的隐私与安全中允许打开，或右键 App 选择“打开”。

常规 electron-builder 打包命令：

```bash
pnpm dist
```

Windows 和 Linux 建议在对应系统上执行打包命令，这样生成的安装包兼容性最好。

## 测试 Elasticsearch

可以用下面的单节点 Elasticsearch 8.x 做本地验证：

```bash
docker run -d --name esclient-test-es -p 9200:9200 \
  -e discovery.type=single-node \
  -e xpack.security.enabled=false \
  -e ES_JAVA_OPTS='-Xms512m -Xmx512m' \
  docker.elastic.co/elasticsearch/elasticsearch:8.19.1
```

客户端中使用 `http://localhost:9200`、无认证即可连接。
