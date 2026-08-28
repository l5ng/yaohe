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

// Control wrappers aligned with codex external-agent-migration/src/sessions/title.rs
const CONTROL_WRAPPERS: ReadonlyArray<readonly [string, string]> = [
  ['<command-message>', '</command-message>'],
  ['<command-name>', '</command-name>'],
  ['<command-args>', '</command-args>'],
  ['<local-command-caveat>', '</local-command-caveat>'],
  ['<local-command-stderr>', '</local-command-stderr>'],
  ['<local-command-stdout>', '</local-command-stdout>'],
  ['<task-notification>', '</task-notification>'],
  ['<system-reminder>', '</system-reminder>'],
  ['<ide_opened_file>', '</ide_opened_file>'],
  ['<ide_selection>', '</ide_selection>'],
]

const USER_QUERY_OPEN = '<user_query>'
const USER_QUERY_CLOSE = '</user_query>'

/**
 * Strip recognized control wrappers from the start of a message, keeping any
 * real user text that follows. Nested wrappers are tracked with a stack,
 * mirroring codex title.rs; unbalanced wrappers leave the text untouched.
 */
export function stripControlWrappers(text: string): string {
  let remainder = text.trimStart()
  for (;;) {
    const end = leadingControlWrapperEnd(remainder)
    if (end === null) return remainder
    remainder = remainder.slice(end).trimStart()
  }
}

function leadingControlWrapperEnd(text: string): number | null {
  const outerIndex = CONTROL_WRAPPERS.findIndex(([open]) => text.startsWith(open))
  if (outerIndex < 0) return null
  const stack: number[] = [outerIndex]
  let cursor = CONTROL_WRAPPERS[outerIndex][0].length

  while (stack.length > 0) {
    const next = text.indexOf('<', cursor)
    if (next < 0) return null
    cursor = next
    const openIndex = CONTROL_WRAPPERS.findIndex(([open]) => text.startsWith(open, cursor))
    if (openIndex >= 0) {
      stack.push(openIndex)
      cursor += CONTROL_WRAPPERS[openIndex][0].length
      continue
    }
    const closeIndex = CONTROL_WRAPPERS.findIndex(([, close]) => text.startsWith(close, cursor))
    if (closeIndex >= 0) {
      if (stack[stack.length - 1] !== closeIndex) return null
      stack.pop()
      cursor += CONTROL_WRAPPERS[closeIndex][1].length
      continue
    }
    cursor += 1
  }
  return cursor
}

/**
 * Unwrap a message that is exactly `<user_query>…</user_query>` with non-empty
 * inner text, matching codex records_cla.rs; anything else is kept as-is.
 */
export function unwrapUserQuery(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith(USER_QUERY_OPEN) && trimmed.endsWith(USER_QUERY_CLOSE)) {
    const inner = trimmed.slice(USER_QUERY_OPEN.length, -USER_QUERY_CLOSE.length).trim()
    if (inner !== '') return inner
  }
  return text
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
