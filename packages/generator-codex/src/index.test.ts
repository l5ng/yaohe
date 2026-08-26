import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { CodexGenerator, codexArgs } from './index.js'

test('uses ephemeral read-only invocation', () => {
  const args = codexArgs('/tmp/last.md')
  expect(args.slice(0, 9)).toEqual([
    'exec',
    '-',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '--color',
    'never',
    '--skip-git-repo-check',
    '--output-last-message',
  ])
  expect(args[9]).toBe('/tmp/last.md')
})

function mockScript(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'yaohe-codex-gen-'))
  const path = join(dir, 'mock-codex')
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

test('reads report from --output-last-message file', async () => {
  const executable = mockScript('cat >/dev/null; printf report > "${10}"')
  const generator = new CodexGenerator(executable)
  const report = await generator.generate('hello', { timeoutSecs: 5 })
  expect(report).toBe('report')
})

test('surfaces nonzero exit from codex cli', async () => {
  const executable = mockScript('cat >/dev/null; printf denied >&2; exit 3')
  const generator = new CodexGenerator(executable)
  await expect(generator.generate('hello', { timeoutSecs: 5 })).rejects.toThrow(/denied/)
})
