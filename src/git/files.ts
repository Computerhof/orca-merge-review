// Working-tree file access for the core, on this machine's file system.
//
// Encoding: files are read as UTF-8 when they are valid UTF-8, otherwise as latin1, which maps
// every byte to one character and back. Conflict markers are ASCII, so they are found either way,
// and a file read as latin1 is written back as latin1: a Windows-1252 or ISO-8859 file keeps
// every byte outside the resolved block instead of turning umlauts into U+FFFD.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FileAccess } from '../core/repo.ts'

const utf8 = new TextDecoder('utf-8', { fatal: true })
/** Files last read as latin1, so the next write of the same path uses latin1 again. */
const readAsLatin1 = new Set<string>()

export const localFiles: FileAccess = {
  async read(absPath) {
    let bytes: Buffer
    try {
      bytes = await readFile(absPath)
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return null
      throw error
    }
    try {
      const text = utf8.decode(bytes)
      readAsLatin1.delete(absPath)
      return text
    } catch {
      readAsLatin1.add(absPath)
      return bytes.toString('latin1')
    }
  },
  write: (absPath, text) => {
    const encoding = readAsLatin1.has(absPath) ? 'latin1' : 'utf8'
    return writeFile(absPath, text, encoding)
  },
  mkdir: async (absPath) => {
    await mkdir(absPath, { recursive: true })
  },
  join: (root, relPath) => join(root, ...relPath.split('/'))
}
