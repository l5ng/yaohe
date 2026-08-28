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
  unwrapUserQuery,
  walkJsonl,
} from './sessions.js'

const IDE_CONTEXT_PREFIX = '# Context from my IDE setup:'
const IMPORTED_TURN_PREFIX = 'external-import-turn-'
const TURN_START_EVENT_TYPES = new Set(['task_started', 'turn_started'])
const INTERNAL_SOURCE_PREFIXES = ['internal_', 'subagent_']
const INTERNAL_THREAD_SOURCES = new Set(['guardian_review', 'memory_consolidation'])
const GUARDIAN_POLICY_PREFIX = 'You are judging one planned coding-agent action.'

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
  let skipSession = false
  let currentTurnId: string | null = null
  let hasEventUserMessage = false
  const eventCandidates: Array<{
    timestamp: string
    text: string
    recordId: string
    turnId: string | null
  }> = []
  const itemCandidates: Array<{ timestamp: string; text: string; recordId: string }> = []

  readJsonlLines(fileText, (value, lineIndex) => {
    if (
      value.type === 'session_meta' &&
      typeof value.payload === 'object' &&
      value.payload !== null
    ) {
      const payload = value.payload as Record<string, unknown>
      const payloadId = payload.id
      if (typeof payloadId === 'string') sessionId = sessionId ?? payloadId
      const payloadCwd = payload.cwd
      if (typeof payloadCwd === 'string') sessionCwd = sessionCwd ?? payloadCwd
      if (isInternalSession(payload)) skipSession = true
      return
    }
    if (value.type === 'event_msg') {
      if (typeof value.payload !== 'object' || value.payload === null) return
      const payload = value.payload as Record<string, unknown>
      if (typeof payload.type !== 'string') return
      if (TURN_START_EVENT_TYPES.has(payload.type)) {
        const turnId = payload.turn_id
        currentTurnId = typeof turnId === 'string' ? turnId : null
        return
      }
      if (payload.type !== 'user_message') return
      const message = payload.message
      if (typeof message !== 'string') return
      const text = message.trim()
      if (text === '') return
      hasEventUserMessage = true
      const instant = parseTimestamp(value.timestamp)
      if (!instant || !windowContains(query.window, instant)) return
      const clientId = payload.client_id
      eventCandidates.push({
        timestamp: instant.toJSON(),
        text,
        recordId: typeof clientId === 'string' ? clientId : String(lineIndex),
        turnId: currentTurnId,
      })
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
    text = unwrapUserQuery(text)
    if (text.trim() === '') return
    const instant = parseTimestamp(value.timestamp)
    if (!instant || !windowContains(query.window, instant)) return
    const recordId = payload.id ?? value.id
    itemCandidates.push({
      timestamp: instant.toJSON(),
      text: text.trim(),
      recordId: typeof recordId === 'string' ? recordId : String(lineIndex),
    })
  })

  if (skipSession) return []
  const cwd = sessionCwd
  if (!cwd || !query.gitRoots.some((root) => pathIsWithin(cwd, root))) return []

  const candidates = hasEventUserMessage
    ? eventCandidates.filter(
        (candidate) => !candidate.turnId?.startsWith(IMPORTED_TURN_PREFIX),
      )
    : itemCandidates

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

/**
 * Decode the serialized SessionSource: a plain string (`"cli"`), or an
 * externally-tagged object such as `{"internal":"guardian"}` or
 * `{"subagent":{"other":"guardian"}}`.
 */
export function sessionSourceKey(source: unknown): string {
  if (typeof source === 'string') return source
  if (typeof source !== 'object' || source === null) return ''
  const outer = source as Record<string, unknown>
  const kind = Object.keys(outer)[0]
  if (kind === undefined) return ''
  const value = outer[kind]
  if (kind === 'internal') return `internal_${String(value)}`
  if (kind === 'subagent') {
    if (typeof value === 'object' && value !== null) {
      const inner = value as Record<string, unknown>
      const innerKind = Object.keys(inner)[0]
      if (innerKind === undefined) return 'subagent_'
      return `subagent_${innerKind === 'other' ? String(inner[innerKind]) : innerKind}`
    }
    return `subagent_${String(value)}`
  }
  return `${kind}_${String(value)}`
}

function isInternalSession(payload: Record<string, unknown>): boolean {
  const sourceKey = sessionSourceKey(payload.source)
  if (INTERNAL_SOURCE_PREFIXES.some((prefix) => sourceKey.startsWith(prefix))) return true
  const threadSource = payload.thread_source
  if (typeof threadSource === 'string' && INTERNAL_THREAD_SOURCES.has(threadSource)) return true
  const baseInstructions = payload.base_instructions
  if (typeof baseInstructions === 'object' && baseInstructions !== null) {
    const text = (baseInstructions as Record<string, unknown>).text
    if (typeof text === 'string' && text.startsWith(GUARDIAN_POLICY_PREFIX)) return true
  }
  return false
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
