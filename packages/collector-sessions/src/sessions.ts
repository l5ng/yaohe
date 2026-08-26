import { readdir } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionEvidence, SessionQuery } from '@l5ng/yaohe-core'

export async function walkJsonl(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => join(entry.parentPath, entry.name))
}

export function pathIsWithin(path: string, root: string): boolean {
  const normalizedPath = canonicalOrNormalized(path)
  const normalizedRoot = canonicalOrNormalized(root)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + '/')
}

function canonicalOrNormalized(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return normalizeLexically(path)
  }
}

function normalizeLexically(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return '/' + parts.join('/')
}

export function extractTextItems(content: unknown, accepted: string[]): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const texts: string[] = []
  for (const item of content) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.type !== 'string' || !accepted.includes(record.type)) continue
    const text = record.text ?? record.input_text
    if (typeof text === 'string' && text.trim() !== '') {
      texts.push(text.trim())
    }
  }
  return texts.join('\n')
}

export function readJsonlLines(
  text: string,
  onLine: (value: Record<string, unknown>, lineIndex: number) => void,
): number {
  let malformed = 0
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    try {
      const value = JSON.parse(line) as Record<string, unknown>
      onLine(value, i)
    } catch {
      malformed += 1
    }
  }
  return malformed
}

/** Wrap a session collector into an 'evidence/session' listener that never breaks other collectors. */
export function sessionCollectorListener(
  id: string,
  collect: (query: SessionQuery) => Promise<SessionEvidence>,
): (query: SessionQuery, acc: SessionEvidence) => Promise<void> {
  return async (query, acc) => {
    try {
      const slice = await collect(query)
      acc.prompts.push(...slice.prompts)
      acc.warnings.push(...slice.warnings)
    } catch (error) {
      acc.warnings.push(`Failed to collect ${id} sessions: ${(error as Error).message}`)
    }
  }
}
