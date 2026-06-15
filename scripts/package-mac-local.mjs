import { mkdir, rm, writeFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve('.')
const releaseDir = resolve(root, 'release')
const stagingDir = '/tmp/esclient-mac-local-staging'
const sourceAppCandidates = [
  resolve(releaseDir, 'ESClient-mac-arm64-local/ESClient.app'),
  resolve(releaseDir, 'ESClient-mac-arm64-local 2/ESClient.app'),
  resolve(releaseDir, 'mac-local-staging/ESClient.app'),
  resolve(releaseDir, 'final-mac-arm64/ES中文客户端.app'),
  resolve(releaseDir, 'fixed-mac-arm64/ES中文客户端.app'),
  resolve(releaseDir, 'manual-mac-arm64/ES中文客户端.app')
]
const appName = 'ESClient.app'
const zipName = 'ESClient-mac-arm64-local.zip'
const appPath = resolve(stagingDir, appName)
const launcherName = 'Open-ESClient.command'
const readmeName = 'README-open.txt'

const run = (command, args, options = {}) =>
  new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr })
      } else {
        const error = new Error(`${command} ${args.join(' ')} failed with exit code ${code}\n${stderr}`)
        error.stdout = stdout
        error.stderr = stderr
        rejectPromise(error)
      }
    })
  })

await rm(stagingDir, { recursive: true, force: true })
await mkdir(stagingDir, { recursive: true })

let sourceApp
for (const candidate of sourceAppCandidates) {
  try {
    const candidateStat = await stat(candidate)
    if (candidateStat.isDirectory()) {
      sourceApp = candidate
      break
    }
  } catch {}
}

if (!sourceApp) {
  throw new Error(`找不到可打包的 app，已尝试：${sourceAppCandidates.join(', ')}`)
}

try {
  const sourceAppStat = await stat(sourceApp)
  if (!sourceAppStat.isDirectory()) {
    throw new Error(`${sourceApp} 不是 app 目录`)
  }
} catch {
  throw new Error(`找不到可打包的 app：${sourceApp}`)
}

await run('ditto', [sourceApp, appPath])
await rm(resolve(appPath, 'Contents/Resources/app/out'), { recursive: true, force: true })
await run('ditto', [resolve(root, 'out'), resolve(appPath, 'Contents/Resources/app/out')])

await rm(resolve(appPath, 'Contents/_CodeSignature'), { recursive: true, force: true })
await run('find', [appPath, '-name', '._*', '-delete'])
await run('xattr', ['-cr', appPath])
await run('codesign', ['--force', '--deep', '--sign', '-', appPath])
await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])

const launcherPath = resolve(stagingDir, launcherName)
await writeFile(
  launcherPath,
  `#!/bin/bash
set -e
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$BASE_DIR/${appName}"
if [ ! -d "$APP" ]; then
  echo "找不到 ${appName}，请确认它和本启动器在同一个文件夹。"
  exit 1
fi
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
xattr -dr com.apple.quarantine "$BASE_DIR/${launcherName}" 2>/dev/null || true
open "$APP"
`,
  'utf8'
)
await run('chmod', ['+x', launcherPath])

await writeFile(
  resolve(stagingDir, readmeName),
  `If ${appName} will not open:\n1. Double-click ${launcherName}.\n2. If macOS blocks it, right-click and choose Open.\n3. The launcher clears quarantine before opening the app.\n`,
  'utf8'
)

await rm(resolve(releaseDir, zipName), { force: true })
await run('ditto', ['-c', '-k', '--sequesterRsrc', stagingDir, resolve(releaseDir, zipName)])

console.log(`created ${zipName}`)
