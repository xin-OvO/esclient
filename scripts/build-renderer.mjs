import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const outDir = resolve('out/renderer')
const assetsDir = resolve(outDir, 'assets')

await rm(outDir, { recursive: true, force: true })
await mkdir(assetsDir, { recursive: true })

await build({
  entryPoints: [resolve('src/renderer/src/main.tsx')],
  outfile: resolve(assetsDir, 'index.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome126'],
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  loader: {
    '.ts': 'ts',
    '.tsx': 'tsx',
    '.css': 'css'
  },
  logLevel: 'info'
})

await writeFile(
  resolve(outDir, 'index.html'),
  `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ES 客户端</title>
    <link rel="stylesheet" href="./assets/index.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./assets/index.js"></script>
  </body>
</html>
`,
  'utf8'
)
