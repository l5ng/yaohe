import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { resolveWindow, type SessionQuery } from '@l5ng/yaohe-core'
import { collectCodex, extractIdeRequest } from './codex.js'

function json(record: Record<string, unknown>): string {
  return `${JSON.stringify(record)}\n`
}

test('extracts last ide request', () => {
  const text = '# Context from my IDE setup:\nfoo\n# My request for Codex:\nfirst\n## My request for Codex:\nsecond'
  expect(extractIdeRequest(text)).toBe('second')
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
