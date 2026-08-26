import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { resolveWindow, type SessionQuery } from '@l5ng/yaohe-core'
import { collectClaude } from './claude.js'
import { sessionCollectorListener } from './sessions.js'

function json(record: Record<string, unknown>): string {
  return `${JSON.stringify(record)}\n`
}

test('keeps only human text and skips injections', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'yaohe-claude-'))
  const project = join(temp, 'project')
  const sessions = join(temp, 'sessions')
  mkdirSync(project)
  mkdirSync(join(sessions, 'projects'), { recursive: true })
  const path = join(sessions, 'projects', 's1.jsonl')

  const content = [
    json({ type: 'user', sessionId: 's1', cwd: project, timestamp: '2026-07-22T01:00:00Z', message: { role: 'user', content: 'implement login' } }),
    json({ type: 'user', cwd: project, timestamp: '2026-07-22T01:01:00Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'secret' }, { type: 'text', text: 'fix the tests' }] } }),
    json({ type: 'user', cwd: project, timestamp: '2026-07-22T01:02:00Z', isMeta: true, message: { role: 'user', content: 'meta' } }),
    json({ type: 'user', cwd: project, timestamp: '2026-07-22T01:03:00Z', message: { role: 'user', content: '/compact' } }),
    'not-json\n',
  ].join('')
  writeFileSync(path, content)

  const query: SessionQuery = {
    gitRoots: [project],
    window: resolveWindow('2026-07-22', 'UTC'),
  }
  try {
    process.env.CLAUDE_CONFIG_DIR = sessions
    const slice = await collectClaude(query)
    expect(slice.prompts.length).toBe(2)
    expect(slice.prompts[0].text).toBe('implement login')
    expect(slice.prompts[1].text).toBe('fix the tests')
    expect(slice.prompts[1].text).not.toContain('secret')
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR
  }
})

test('filters sessions outside the git roots', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'yaohe-claude-'))
  const project = join(temp, 'project')
  const other = join(temp, 'other')
  const sessions = join(temp, 'sessions')
  mkdirSync(project)
  mkdirSync(other)
  mkdirSync(join(sessions, 'projects'), { recursive: true })
  writeFileSync(
    join(sessions, 'projects', 'elsewhere.jsonl'),
    `${JSON.stringify({ type: 'user', sessionId: 'e', cwd: other, timestamp: '2026-07-22T01:00:00Z', message: { role: 'user', content: 'another project' } })}\n`,
  )
  const query: SessionQuery = {
    gitRoots: [project],
    window: resolveWindow('2026-07-22', 'UTC'),
  }
  try {
    process.env.CLAUDE_CONFIG_DIR = sessions
    const slice = await collectClaude(query)
    expect(slice.prompts.length).toBe(0)
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR
  }
})

test('session collector listener isolates failures into warnings', async () => {
  const listener = sessionCollectorListener('broken', async () => {
    throw new Error('boom')
  })
  const acc = { prompts: [], warnings: [] }
  await listener({ gitRoots: ['/tmp'], window: resolveWindow('2026-07-22', 'UTC') }, acc)
  expect(acc.prompts.length).toBe(0)
  expect(acc.warnings[0]).toContain('broken')
  expect(acc.warnings[0]).toContain('boom')
})
