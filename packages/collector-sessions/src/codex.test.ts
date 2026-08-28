import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { resolveWindow, type SessionQuery } from '@l5ng/yaohe-core'
import { collectCodex, extractIdeRequest, sessionSourceKey } from './codex.js'

function json(record: Record<string, unknown>): string {
  return `${JSON.stringify(record)}\n`
}

test('sessionSourceKey decodes string and object shapes', () => {
  expect(sessionSourceKey('cli')).toBe('cli')
  expect(sessionSourceKey('unified_exec_startup')).toBe('unified_exec_startup')
  expect(sessionSourceKey({ internal: 'guardian' })).toBe('internal_guardian')
  expect(sessionSourceKey({ internal: 'memory_consolidation' })).toBe(
    'internal_memory_consolidation',
  )
  expect(sessionSourceKey({ subagent: 'review' })).toBe('subagent_review')
  expect(sessionSourceKey({ subagent: 'memory_consolidation' })).toBe(
    'subagent_memory_consolidation',
  )
  expect(sessionSourceKey({ subagent: { other: 'guardian' } })).toBe('subagent_guardian')
  expect(sessionSourceKey({ subagent: { thread_spawn: { depth: 1 } } })).toBe(
    'subagent_thread_spawn',
  )
  expect(sessionSourceKey(null)).toBe('')
  expect(sessionSourceKey(undefined)).toBe('')
})

test('extracts last ide request', () => {
  const text = '# Context from my IDE setup:\nfoo\n# My request for Codex:\nfirst\n## My request for Codex:\nsecond'
  expect(extractIdeRequest(text)).toBe('second')
})

test('collects raw user_message events and ignores response items', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'yaohe-codex-'))
  const project = join(temp, 'project')
  const sessions = join(temp, 'sessions')
  mkdirSync(project)
  mkdirSync(join(sessions, 'sessions'), { recursive: true })

  const content = [
    json({
      timestamp: '2026-07-22T01:00:00Z',
      type: 'session_meta',
      payload: { id: 'events', cwd: project, source: 'cli', thread_source: 'user' },
    }),
    json({ timestamp: '2026-07-22T01:00:01Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } }),
    json({ timestamp: '2026-07-22T01:00:02Z', type: 'event_msg', payload: { type: 'user_message', message: 'build the daily report' } }),
    json({
      timestamp: '2026-07-22T01:00:03Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>injected</environment_context>' }] },
    }),
    json({
      timestamp: '2026-07-22T01:00:04Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'duplicate via response item' }] },
    }),
  ].join('')
  writeFileSync(join(sessions, 'sessions', 'events.jsonl'), content)

  const query: SessionQuery = {
    gitRoots: [project],
    window: resolveWindow('2026-07-22', 'UTC'),
  }
  try {
    process.env.CODEX_HOME = sessions
    const slice = await collectCodex(query)
    expect(slice.prompts.length).toBe(1)
    expect(slice.prompts[0].text).toBe('build the daily report')
  } finally {
    delete process.env.CODEX_HOME
  }
})

test('falls back to response_item messages when no user_message event exists', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'yaohe-codex-'))
  const project = join(temp, 'project')
  const sessions = join(temp, 'sessions')
  mkdirSync(project)
  mkdirSync(join(sessions, 'sessions'), { recursive: true })

  const content = [
    json({
      timestamp: '2026-07-22T01:00:00Z',
      type: 'session_meta',
      payload: { id: 'fallback', cwd: project, source: 'cli' },
    }),
    json({
      timestamp: '2026-07-22T01:00:01Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '<environment_context>injected</environment_context>' }],
      },
    }),
    json({
      timestamp: '2026-07-22T01:00:02Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '# Context from my IDE setup:\nctx\n## My request for Codex:\nrun the migration' }],
      },
    }),
    json({
      timestamp: '2026-07-22T01:00:03Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<user_query>plain query</user_query>' }] },
    }),
  ].join('')
  writeFileSync(join(sessions, 'sessions', 'fallback.jsonl'), content)

  const query: SessionQuery = {
    gitRoots: [project],
    window: resolveWindow('2026-07-22', 'UTC'),
  }
  try {
    process.env.CODEX_HOME = sessions
    const slice = await collectCodex(query)
    const texts = slice.prompts.map((prompt) => prompt.text)
    expect(texts).toContain('run the migration')
    expect(texts).toContain('plain query')
    expect(texts).not.toContain('<user_query>')
    expect(texts).not.toContain('injected')
    expect(slice.prompts.length).toBe(2)
  } finally {
    delete process.env.CODEX_HOME
  }
})

test('skips imported external turns and accepts both turn event names', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'yaohe-codex-'))
  const project = join(temp, 'project')
  const sessions = join(temp, 'sessions')
  mkdirSync(project)
  mkdirSync(join(sessions, 'sessions'), { recursive: true })

  writeFileSync(
    join(sessions, 'sessions', 'imported.jsonl'),
    [
      json({ timestamp: '2026-07-22T01:00:00Z', type: 'session_meta', payload: { id: 'imported', cwd: project, source: 'cli' } }),
      json({ timestamp: '2026-07-22T01:00:01Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'external-import-turn-1' } }),
      json({ timestamp: '2026-07-22T01:00:02Z', type: 'event_msg', payload: { type: 'user_message', message: 'imported claude prompt' } }),
      json({ timestamp: '2026-07-22T01:00:03Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'local-turn' } }),
      json({ timestamp: '2026-07-22T01:00:04Z', type: 'event_msg', payload: { type: 'user_message', message: 'local prompt' } }),
    ].join(''),
  )
  writeFileSync(
    join(sessions, 'sessions', 'v2-imported.jsonl'),
    [
      json({ timestamp: '2026-07-22T01:00:00Z', type: 'session_meta', payload: { id: 'v2', cwd: project, source: 'cli' } }),
      json({ timestamp: '2026-07-22T01:00:01Z', type: 'event_msg', payload: { type: 'turn_started', turn_id: 'external-import-turn-2' } }),
      json({ timestamp: '2026-07-22T01:00:02Z', type: 'event_msg', payload: { type: 'user_message', message: 'imported via v2' } }),
    ].join(''),
  )

  const query: SessionQuery = {
    gitRoots: [project],
    window: resolveWindow('2026-07-22', 'UTC'),
  }
  try {
    process.env.CODEX_HOME = sessions
    const slice = await collectCodex(query)
    expect(slice.prompts.length).toBe(1)
    expect(slice.prompts[0].text).toBe('local prompt')
  } finally {
    delete process.env.CODEX_HOME
  }
})

test('skips internal guardian and memory consolidation sessions', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'yaohe-codex-'))
  const project = join(temp, 'project')
  const sessions = join(temp, 'sessions')
  mkdirSync(project)
  mkdirSync(join(sessions, 'sessions'), { recursive: true })

  const files: Array<[string, Record<string, unknown>]> = [
    [
      'guardian-source.jsonl',
      {
        id: 'g1',
        cwd: project,
        source: { subagent: { other: 'guardian' } },
        thread_source: 'subagent',
        base_instructions: { text: 'You are judging one planned coding-agent action.' },
      },
    ],
    [
      'guardian-thread.jsonl',
      { id: 'g2', cwd: project, source: 'cli', thread_source: 'guardian_review' },
    ],
    [
      'guardian-instructions.jsonl',
      {
        id: 'g3',
        cwd: project,
        source: 'cli',
        thread_source: 'user',
        base_instructions: {
          text: 'You are judging one planned coding-agent action. Approve or deny the action.',
        },
      },
    ],
    [
      'memory-internal.jsonl',
      { id: 'm1', cwd: project, source: { internal: 'memory_consolidation' } },
    ],
    [
      'memory-subagent.jsonl',
      { id: 'm2', cwd: project, source: { subagent: 'memory_consolidation' } },
    ],
  ]
  for (const [fileName, meta] of files) {
    writeFileSync(
      join(sessions, 'sessions', fileName),
      json({ timestamp: '2026-07-22T01:00:00Z', type: 'session_meta', payload: meta })
        + json({
            timestamp: '2026-07-22T01:00:01Z',
            type: 'event_msg',
            payload: { type: 'user_message', message: 'should not be collected' },
          }),
    )
  }

  const query: SessionQuery = {
    gitRoots: [project],
    window: resolveWindow('2026-07-22', 'UTC'),
  }
  try {
    process.env.CODEX_HOME = sessions
    const slice = await collectCodex(query)
    expect(slice.prompts.length).toBe(0)
  } finally {
    delete process.env.CODEX_HOME
  }
})

test('filters injections and subagents', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'yaohe-codex-'))
  const project = join(temp, 'project')
  const sessions = join(temp, 'sessions')
  mkdirSync(project)
  mkdirSync(join(sessions, 'sessions'), { recursive: true })

  const meta = json({ timestamp: '2026-07-22T01:00:00Z', type: 'session_meta', payload: { id: 'normal', cwd: project, source: 'cli' } })
  const injected = json({ timestamp: '2026-07-22T01:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>ignore</environment_context>' }] } })
  const ide = json({ timestamp: '2026-07-22T01:02:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# Context from my IDE setup:\nctx\n# My request for Codex:\nbuild the daily report' }] } })
  writeFileSync(join(sessions, 'sessions', 'normal.jsonl'), meta + injected + ide)
  writeFileSync(
    join(sessions, 'sessions', 'subagent.jsonl'),
    json({ timestamp: '2026-07-22T01:00:00Z', type: 'session_meta', payload: { id: 'sub', cwd: project, source: { subagent: 'worker' } } })
      + json({ timestamp: '2026-07-22T01:01:00Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'should not be collected' }] } }),
  )

  const query: SessionQuery = {
    gitRoots: [project],
    window: resolveWindow('2026-07-22', 'UTC'),
  }
  try {
    process.env.CODEX_HOME = sessions
    const slice = await collectCodex(query)
    expect(slice.prompts.length).toBe(1)
    expect(slice.prompts[0].text).toBe('build the daily report')
  } finally {
    delete process.env.CODEX_HOME
  }
})
