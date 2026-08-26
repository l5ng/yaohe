import { expect, test } from 'vitest'
import { parseCliArgs } from './args.js'

test('parses flags, repeated -v and positional command', () => {
  const cli = parseCliArgs([
    'report',
    '--project', '/tmp/repo',
    '--date', '2026-07-22',
    '--agent', 'codex',
    '-vv',
    '--all-worktrees',
  ])
  expect(cli.command).toBe('report')
  expect(cli.project).toBe('/tmp/repo')
  expect(cli.date).toBe('2026-07-22')
  expect(cli.agent).toBe('codex')
  expect(cli.verbosity).toBe(2)
  expect(cli.allWorktrees).toBe(true)
})

test('parses --template-lang with choices', () => {
  expect(parseCliArgs(['--template-lang', 'zh']).templateLang).toBe('zh')
  expect(parseCliArgs(['--template-lang', 'auto']).templateLang).toBe('auto')
  expect(parseCliArgs([]).templateLang).toBeNull()
  expect(() => parseCliArgs(['--template-lang', 'fr'])).toThrow(/Allowed choices/)
})

test('rejects unknown command and conflicting author flags', () => {
  expect(() => parseCliArgs(['frobnicate'])).toThrow(/Unknown command/)
  expect(() => parseCliArgs(['--author', 'a@b.c', '--all-authors'])).toThrow(/cannot be used/)
  expect(() => parseCliArgs(['--agent', 'gpt'])).toThrow(/Allowed choices are auto, codex, claude/)
  expect(() => parseCliArgs(['--timeout', '0'])).toThrow(/between 1 and 86400/)
})
