import { expect, test } from 'vitest'
import { DEFAULT_BUDGETS } from './budgets.js'
import { renderGenerationContext } from './context-render.js'
import {
  manyCommitsContext,
  mixedDayContext,
  multiWorktreeContext,
  promptsOnlyContext,
} from './fixtures/contexts.js'

test('renders a compact pruned context for a mixed day', () => {
  const text = renderGenerationContext(mixedDayContext())
  expect(text).toContain('Report date: 2026-07-22 (Asia/Shanghai)')
  expect(text).toContain('Project: demo')
  expect(text).toContain('Commits (2):')
  expect(text).toContain('- [09:00Z] Add budget trimming for the report context (+120 -30, 6 files)')
  expect(text).toContain('- [10:20Z] Fix the README badge link (+1 -1, 1 file)')
  expect(text).toContain('Uncommitted changes:')
  expect(text).toContain('- staged: 2 file(s) (+10 -2): src/prompt.ts, packages/core/src/model.ts')
  expect(text).toContain('- unstaged: 1 file(s) (+3 -1): README.md')
  expect(text).toContain('- untracked: 2 path(s): notes/todo.md, scratch/log.txt')
  expect(text).toContain('User prompts (2):')
  expect(text).toContain('- [08:20Z] (codex) Implement budget trimming for the report context')
  expect(text).toContain('- [09:20Z] (claude) Fix the README badge link')
  expect(text).toContain('Estimated activity: 96 minutes (estimate; derived from user prompt timestamps)')
  expect(text).toContain('README excerpt (project background):')
})

test('renders no internal or sensitive fields', () => {
  const text = renderGenerationContext(mixedDayContext())
  expect(text).not.toContain('session_id')
  expect(text).not.toContain('record_id')
  expect(text).not.toContain('git_root')
  expect(text).not.toContain('author_filter')
  expect(text).not.toContain('schema_version')
  expect(text).not.toContain('cwd')
  expect(text).not.toContain('/tmp/demo')
  expect(text).not.toMatch(/\b[0-9a-f]{40}\b/)
})

test('truncates long commit subjects and caps path lists', () => {
  const context = mixedDayContext()
  context.git.commits[0].subject = 'a'.repeat(200)
  context.git.working_tree!.staged = {
    files_changed: 60,
    additions: 60,
    deletions: 0,
    paths: Array.from({ length: 60 }, (_, index) => `src/file-${index}.ts`),
  }
  const text = renderGenerationContext(context)
  expect(text).toContain(`${'a'.repeat(140)}…`)
  expect(text).toContain('src/file-0.ts')
  expect(text).toContain('src/file-49.ts')
  expect(text).toContain('(+10 more)')
  expect(text).not.toContain('src/file-50.ts')
})

test('annotates commits that span multiple worktrees', () => {
  const text = renderGenerationContext(multiWorktreeContext())
  expect(text).toContain('Commits (1):')
  expect(text).toContain('(worktrees: main, feature)')
  expect(text).toContain('Uncommitted changes (worktrees):')
  expect(text).toContain('Worktree main (main):')
  expect(text).toContain('- staged: 1 file(s) (+5 -0): packages/core/src/model.ts')
  expect(text).toContain('Worktree feature (feature):')
  expect(text).toContain('- unstaged: 2 file(s) (+8 -3): src/cli.ts, src/args.ts')
})

test('omits empty sections', () => {
  const text = renderGenerationContext(promptsOnlyContext())
  expect(text).not.toContain('Commits')
  expect(text).not.toContain('Uncommitted changes')
  expect(text).toContain('User prompts (2):')
  expect(text).toContain('Estimated activity: no verifiable record')
})

test('degrades the rendered context in priority order when over budget', () => {
  const context = manyCommitsContext(40)
  const warnings: string[] = []
  const text = renderGenerationContext(context, { ...DEFAULT_BUDGETS, total_chars: 900 }, warnings)
  expect(text.length).toBeLessThanOrEqual(900)
  expect(warnings.some((warning) => warning.includes('exceeded the total character budget'))).toBe(true)
  expect(warnings.some((warning) => warning.includes('oldest commit'))).toBe(true)
  expect(text).not.toContain('(+10 -2')
  expect(text).toMatch(/Commits \(\d+\):/)
})

test('reports degradation warnings only when something was omitted', () => {
  const warnings: string[] = []
  renderGenerationContext(mixedDayContext(), DEFAULT_BUDGETS, warnings)
  expect(warnings).toEqual([])
})
