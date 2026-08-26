import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  renameSync,
  unlinkSync,
  linkSync,
  writeFileSync,
  existsSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { YaoheError } from './error.js'

/** Atomic write: temp file in the same directory + fsync; --force replaces via rename, otherwise link enforces no-clobber semantics. */
export function writeOutput(path: string, text: string, force: boolean): void {
  if (existsSync(path) && !force) {
    throw new YaoheError(`Output file ${path} already exists; use --force to overwrite`, 'OUTPUT_FAILED')
  }
  const parent = dirname(path) || '.'
  mkdirSync(parent, { recursive: true })

  const tempPath = join(parent, `.${randomUUID()}.tmp`)
  try {
    const fd = openSync(tempPath, 'w')
    try {
      writeFileSync(fd, text)
      fsyncSync(fd)
      if (force) {
        renameSync(tempPath, path)
      } else {
        try {
          linkSync(tempPath, path)
        } catch (error) {
          throw new YaoheError(
            `Failed to atomically write ${path}; the target may already exist: ${(error as Error).message}`,
            'OUTPUT_FAILED',
            { cause: error },
          )
        }
        unlinkSync(tempPath)
      }
    } finally {
      closeSync(fd)
    }
  } finally {
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath)
      } catch {
        // Temp-file cleanup failure must not mask the result
      }
    }
  }
}
