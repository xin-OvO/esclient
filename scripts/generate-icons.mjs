import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const root = new URL('..', import.meta.url).pathname
const iconDir = join(root, 'build', 'icons')
const execFileAsync = promisify(execFile)

const crcTable = new Uint32Array(256)
for (let index = 0; index < 256; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  crcTable[index] = value >>> 0
}

const crc32 = (buffer) => {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)))

const drawIcon = (size) => {
  const data = Buffer.alloc((size * 4 + 1) * size)
  const center = size / 2
  const radius = size * 0.42

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1)
    data[rowStart] = 0

    for (let x = 0; x < size; x += 1) {
      const dx = x - center
      const dy = y - center
      const distance = Math.sqrt(dx * dx + dy * dy)
      const offset = rowStart + 1 + x * 4
      const gradient = (x + y) / (size * 2)
      const inBadge = distance <= radius

      let red = 16 + gradient * 28
      let green = 74 + gradient * 48
      let blue = 116 + gradient * 72

      if (inBadge) {
        red = 30 + gradient * 12
        green = 116 + gradient * 80
        blue = 184 + gradient * 52
      }

      const isE =
        inBadge &&
        x > size * 0.28 &&
        x < size * 0.56 &&
        ((y > size * 0.28 && y < size * 0.36) ||
          (y > size * 0.46 && y < size * 0.54) ||
          (y > size * 0.64 && y < size * 0.72) ||
          (x > size * 0.28 && x < size * 0.36 && y > size * 0.28 && y < size * 0.72))
      const isS =
        inBadge &&
        x > size * 0.58 &&
        x < size * 0.75 &&
        ((y > size * 0.28 && y < size * 0.36) ||
          (y > size * 0.46 && y < size * 0.54) ||
          (y > size * 0.64 && y < size * 0.72) ||
          (x > size * 0.58 && x < size * 0.66 && y > size * 0.28 && y < size * 0.54) ||
          (x > size * 0.67 && x < size * 0.75 && y > size * 0.46 && y < size * 0.72))

      if (isE || isS) {
        red = 245
        green = 249
        blue = 255
      }

      data[offset] = clamp(red)
      data[offset + 1] = clamp(green)
      data[offset + 2] = clamp(blue)
      data[offset + 3] = 255
    }
  }

  return data
}

const png = (size) => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  header[10] = 0
  header[11] = 0
  header[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(drawIcon(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const ico = (images) => {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  let offset = 6 + images.length * 16
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    return entry
  })

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)])
}

await mkdir(iconDir, { recursive: true })

const sizes = [16, 32, 64, 128, 256, 512, 1024]
const images = await Promise.all(
  sizes.map(async (size) => {
    const data = png(size)
    await writeFile(join(iconDir, `icon-${size}.png`), data)
    return { size, data }
  })
)

await writeFile(join(iconDir, 'icon.png'), images.find((image) => image.size === 512).data)
await writeFile(join(iconDir, 'icon.ico'), ico(images.filter((image) => [16, 32, 64, 128, 256].includes(image.size))))

if (process.platform === 'darwin') {
  const iconsetDir = join(iconDir, 'icon.iconset')
  await mkdir(iconsetDir, { recursive: true })
  const iconsetFiles = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024]
  ]

  await Promise.all(
    iconsetFiles.map(([name, size]) => writeFile(join(iconsetDir, name), images.find((image) => image.size === size).data))
  )
  await execFileAsync('iconutil', ['-c', 'icns', iconsetDir, '-o', join(iconDir, 'icon.icns')])
  await rm(iconsetDir, { recursive: true, force: true })
}
