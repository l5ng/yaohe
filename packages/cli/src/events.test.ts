import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from 'cordis'
import { resolveWindow, type SessionEvidence, type SessionQuery } from '@l5ng/yaohe-core'
import { claudePlugin, codexPlugin } from '@l5ng/yaohe-collector-sessions'
import { plugin as claudeGenerator } from '@l5ng/yaohe-generator-claude'
import { plugin as codexGenerator } from '@l5ng/yaohe-generator-codex'
import { expect, test } from 'vitest'

function mockCommand(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'yaohe-events-'))
  const path = join(dir, 'mock')
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

test('generator select prefers codex and falls back to claude', async () => {
  const working = mockCommand('exit 0')
  const broken = mockCommand('exit 3')

  const ctx = new Context()
  ctx.plugin(codexGenerator, { command: working })
  ctx.plugin(claudeGenerator, { command: working })
  const errors: string[] = []
  expect((await ctx.serial('generator/select', 'auto', errors))?.id).toBe('codex')

  const fallback = new Context()
  fallback.plugin(codexGenerator, { command: broken })
  fallback.plugin(claudeGenerator, { command: working })
  const fallbackErrors: string[] = []
  expect((await fallback.serial('generator/select', 'auto', fallbackErrors))?.id).toBe('claude')
  expect(fallbackErrors.length).toBe(1)
})

test('generator select reports the availability error for an explicit choice', async () => {
  const broken = mockCommand('exit 3')
  const ctx = new Context()
  ctx.plugin(codexGenerator, { command: broken })
  const errors: string[] = []
  expect(await ctx.serial('generator/select', 'codex', errors)).toBeUndefined()
  expect(errors.join('; ')).toContain('failed (3)')
})

test('session collectors merge into one accumulator', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'yaohe-events-'))
  const project = join(temp, 'project')
  const sessions = join(temp, 'sessions')
  mkdirSync(project)
  mkdirSync(join(sessions, 'projects'), { recursive: true })
  mkdirSync(join(sessions, 'sessions'), { recursive: true })
  writeFileSync(
    join(sessions, 'projects', 'c1.jsonl'),
    `${JSON.stringify({
      type: 'user',
      sessionId: 'c',
      cwd: project,
      timestamp: '2026-07-22T01:00:00Z',
      message: { role: 'user', content: 'claude prompt' },
    })}\n`,
  )
  writeFileSync(
    join(sessions, 'sessions', 'x1.jsonl'),
    `${JSON.stringify({
      timestamp: '2026-07-22T01:00:00Z',
      type: 'session_meta',
      payload: { id: 'x', cwd: project, source: 'cli' },
    })}\n${JSON.stringify({
      timestamp: '2026-07-22T01:01:00Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'codex prompt' }] },
    })}\n`,
  )

  const savedClaude = process.env.CLAUDE_CONFIG_DIR
  const savedCodex = process.env.CODEX_HOME
  try {
    process.env.CLAUDE_CONFIG_DIR = sessions
    process.env.CODEX_HOME = sessions
    const ctx = new Context()
    ctx.plugin(claudePlugin)
    ctx.plugin(codexPlugin)
    const query: SessionQuery = {
      gitRoots: [project],
      window: resolveWindow('2026-07-22', 'UTC'),
    }
    const acc: SessionEvidence = { prompts: [], warnings: [] }
    await ctx.serial('evidence/session', query, acc)
    expect(acc.prompts.map((prompt) => prompt.text)).toEqual(['claude prompt', 'codex prompt'])
    expect(acc.warnings.length).toBe(0)
  } finally {
    if (savedClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = savedClaude
    if (savedCodex === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = savedCodex
  }
})
