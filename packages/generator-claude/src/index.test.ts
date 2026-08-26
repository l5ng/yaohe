import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { ClaudeGenerator, claudeArgs } from './index.js'

test('disables tools and session persistence', () => {
  expect(claudeArgs()).toEqual([
    '-p',
    '--output-format',
    'text',
    '--no-session-persistence',
    '--tools',
    '',
  ])
})

function mockScript(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'yaohe-claude-gen-'))
  const path = join(dir, 'mock-claude')
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

test('reads report from stdout', async () => {
  const executable = mockScript('input=$(cat); [ "$input" = hello ]; printf report')
  const generator = new ClaudeGenerator(executable)
  const report = await generator.generate('hello', { timeoutSecs: 5 })
  expect(report).toBe('report')
})

test('rejects empty claude output', async () => {
  const executable = mockScript('cat >/dev/null; printf "  \n"')
  const generator = new ClaudeGenerator(executable)
  await expect(generator.generate('hello', { timeoutSecs: 5 })).rejects.toThrow(/is empty/)
})
