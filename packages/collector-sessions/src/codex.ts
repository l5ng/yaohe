import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { Context } from 'cordis'
import {
  parseTimestamp,
  windowContains,
  type SessionEvidence,
  type SessionQuery,
  type UserPrompt,
} from '@l5ng/yaohe-core'
import {
  extractTextItems,
  pathIsWithin,
  readJsonlLines,
  sessionCollectorListener,
  walkJsonl,
} from './sessions.js'

const IDE_CONTEXT_PREFIX = '# Context from my IDE setup:'

export const name = 'collector-codex-sessions'

export const codexPlugin = { name, apply }

export function apply(ctx: Context): void {
  ctx.on('evidence/session', sessionCollectorListener('codex', collectCodex))
}

export async function collectCodex(query: SessionQuery): Promise<SessionEvidence> {
  const prompts: UserPrompt[] = []
  for (const root of codexRoots()) {
    let files: string[]
    try {
      files = await walkJsonl(root)
    } catch {
      continue
    }
    for (const file of files) {
      const filePrompts = await parseCodexFile(file, query)
      prompts.push(...filePrompts)
    }
  }
  return { prompts, warnings: [] }
}

function codexRoots(): string[] {
  const home = process.env.CODEX_HOME ?? join(homedir(), '.codex')
  return [join(home, 'sessions'), join(home, 'archived_sessions')]
}

export async function parseCodexFile(
  path: string,
  query: SessionQuery,
): Promise<UserPrompt[]> {
  const fileText = await readFile(path, 'utf8')
  const fallbackSessionId = basename(path).replace(/\.jsonl$/, '') || 'unknown'
  let sessionId: string | null = null
  let sessionCwd: string | null = null
  let isSubagent = false
  const candidates: Array<{ timestamp: string; text: string; recordId: string }> = []

  readJsonlLines(fileText, (value, lineIndex) => {
    if (value.type === 'session_meta' && typeof value.payload === 'object' && value.payload !== null) {
      const payload = value.payload as Record<string, unknown>
      const payloadId = payload.id
      if (typeof payloadId === 'string') sessionId = sessionId ?? payloadId
      const payloadCwd = payload.cwd
      if (typeof payloadCwd === 'string') sessionCwd = sessionCwd ?? payloadCwd
      if (containsSubagent(payload.source)) isSubagent = true
      return
    }
    if (value.type !== 'response_item') return
    if (typeof value.payload !== 'object' || value.payload === null) return
    const payload = value.payload as Record<string, unknown>
    if (payload.type !== 'message' || payload.role !== 'user') return
    let text = extractTextItems(payload.content, ['input_text', 'text'])
    if (shouldSkipInjected(text)) return
    if (text.trimStart().startsWith(IDE_CONTEXT_PREFIX)) {
      const extracted = extractIdeRequest(text)
      if (extracted === null) return
      text = extracted
    }
    if (text.trim() === '') return
    const instant = parseTimestamp(value.timestamp)
    if (!instant || !windowContains(query.window, instant)) return
    const recordId = payload.id ?? value.id
    candidates.push({
      timestamp: instant.toJSON(),
      text: text.trim(),
      recordId: typeof recordId === 'string' ? recordId : String(lineIndex),
    })
  })

  if (isSubagent) return []
  const cwd = sessionCwd
  if (!cwd || !query.gitRoots.some((root) => pathIsWithin(cwd, root))) return []

  const sessionIdValue = sessionId ?? fallbackSessionId
  const seen = new Set<string>()
  const prompts: UserPrompt[] = []
  for (const candidate of candidates) {
    const key = `codex\0${sessionIdValue}\0${candidate.timestamp}\0${candidate.recordId}`
    if (seen.has(key)) continue
    seen.add(key)
    prompts.push({
      provider: 'codex',
      session_id: sessionIdValue,
      timestamp: candidate.timestamp,
      cwd,
      text: candidate.text,
      record_id: candidate.recordId,
    })
  }
  return prompts
}

function containsSubagent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSubagent)
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, child]) => key.toLowerCase() === 'subagent' || containsSubagent(child),
    )
  }
  return typeof value === 'string' && value.toLowerCase().includes('subagent')
}

export function shouldSkipInjected(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith('<environment_context>')
    || trimmed.startsWith('# AGENTS.md')
    || trimmed.startsWith('<developer')
    || trimmed.startsWith('<system')
}

export function extractIdeRequest(text: string): string | null {
  let bodyStart: number | null = null
  let offset = 0
  for (const line of text.split(/(?<=\n)/)) {
    const heading = line.trim()
      .replace(/^#+/, '')
      .trim()
      .replace(/:$/, '')
      .trim()
    if (heading.toLowerCase() === 'my request for codex') {
      bodyStart = offset + line.length
    }
    offset += line.length
  }
  if (bodyStart === null) return null
  const body = text.slice(bodyStart).trim()
  return body === '' ? null : body
}
