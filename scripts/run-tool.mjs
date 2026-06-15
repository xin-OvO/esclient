import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const toolMap = {
  tsc: ['node', ['node_modules/typescript/bin/tsc']],
  'electron-vite': ['node', ['node_modules/electron-vite/bin/electron-vite.js']],
  'electron-builder': ['node', ['node_modules/electron-builder/cli.js']]
}

const [toolName, ...toolArgs] = process.argv.slice(2)
const tool = toolMap[toolName]

if (!tool) {
  console.error(`Unknown tool: ${toolName || '(missing)'}`)
  process.exit(1)
}

const [command, baseArgs] = tool
const child = spawn(command, [...baseArgs, ...toolArgs], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`${toolName} exited with signal ${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 0)
})
