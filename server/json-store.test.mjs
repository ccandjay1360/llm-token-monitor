import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeJsonAtomically } from './json-store.js'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'token-monitor-json-'))
const filePath = path.join(directory, 'data.json')

try {
  writeJsonAtomically(filePath, { version: 1 })
  writeJsonAtomically(filePath, { version: 2, providers: ['demo'] })
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { version: 2, providers: ['demo'] })
  assert.equal(fs.existsSync(`${filePath}.tmp`), false)
} finally {
  fs.rmSync(directory, { recursive: true, force: true })
}

console.log('json store test passed')
