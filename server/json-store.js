import fs from 'node:fs'
import path from 'node:path'

export function writeJsonAtomically(filePath, data) {
  const directory = path.dirname(filePath)
  const temporaryFile = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const backupFile = `${filePath}.bak`
  let originalMoved = false

  fs.mkdirSync(directory, { recursive: true })
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2), 'utf8')
    if (fs.existsSync(backupFile)) fs.rmSync(backupFile, { force: true })
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, backupFile)
      originalMoved = true
    }
    fs.renameSync(temporaryFile, filePath)
    if (originalMoved) fs.rmSync(backupFile, { force: true })
  } catch (error) {
    if (fs.existsSync(temporaryFile)) fs.rmSync(temporaryFile, { force: true })
    if (originalMoved && !fs.existsSync(filePath) && fs.existsSync(backupFile)) {
      fs.renameSync(backupFile, filePath)
    }
    throw error
  }
}
