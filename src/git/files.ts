// Working-tree file access for the core, on this machine's file system.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FileAccess } from '../core/repo.ts'

export const localFiles: FileAccess = {
  async read(absPath) {
    try {
      return await readFile(absPath, 'utf8')
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return null
      throw error
    }
  },
  write: (absPath, text) => writeFile(absPath, text, 'utf8'),
  mkdir: async (absPath) => {
    await mkdir(absPath, { recursive: true })
  },
  join: (root, relPath) => join(root, ...relPath.split('/'))
}
