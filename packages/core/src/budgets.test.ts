import { expect, test } from 'vitest'
import { estimateActivity } from './activity.js'
import { applyBudgets, DEFAULT_BUDGETS } from './budgets.js'
import {
  EMPTY_ACTIVITY,
  EMPTY_TRUNCATION,
  type GitEvidence,
  type ProjectContext,
  type ReportContext,
  type UserPrompt,
} from './model.js'

function makePrompt(minute: number, session = 's'): UserPrompt {
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return {
    provider: 'codex',
    session_id: session,
    timestamp: `2026-07-22T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`,
    cwd: '/tmp/p',
    text: 'x',
    record_id: String(minute),
  }
}

test('activity estimate splits long gaps', () => {
  const estimate = estimateActivity([makePrompt(0), makePrompt(20), makePrompt(55)])
  expect(estimate.estimated_minutes).toBe(20)
  expect(estimate.segments).toBe(2)
})

function makeContext(prompts: UserPrompt[]): ReportContext {
  const project: ProjectContext = {
    name: 'demo',
    git_root: '/tmp/demo',
    readme_excerpt: null,
    all_worktrees: false,
    worktree_count: 1,
  }
  const git: GitEvidence = {
    author_filter: null,
    commits: [],
    working_tree: null,
    worktrees: [],
  }
  return {
    schema_version: 2,
    report_date: '2026-07-22',
    timezone: 'Asia/Shanghai',
    project,
    prompts,
    git,
    activity_estimate: EMPTY_ACTIVITY,
    warnings: [],
    truncation: EMPTY_TRUNCATION,
  }
}

test('budget keeps newest prompts within prompt_chars', () => {
  const prompts = [
    makePrompt(0),
    { ...makePrompt(1), text: 'b'.repeat(300) },
    { ...makePrompt(2), text: 'c'.repeat(300) },
  ]
  const context = makeContext(prompts)
  // prompt_chars=350: c(300)+a(1) fit, b(300) pushes the running total to 601 and gets dropped
  applyBudgets(context, { ...DEFAULT_BUDGETS, prompt_chars: 350 })
  expect(context.prompts.map((p) => p.record_id)).toEqual(['0', '2'])
  expect(context.truncation.prompts_dropped).toBe(1)
  expect(context.warnings.some((w) => w.includes('older prompt'))).toBe(true)
})

test('budget removes readme excerpt first when over total', () => {
  const context = makeContext([makePrompt(0)])
  context.project.readme_excerpt = 'x'.repeat(400)
  applyBudgets(context, { ...DEFAULT_BUDGETS, total_chars: 200, prompt_chars: 100 })
  expect(context.project.readme_excerpt).toBeNull()
  expect(context.truncation.readme_truncated).toBe(true)
})
