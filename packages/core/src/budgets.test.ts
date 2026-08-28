import { expect, test } from 'vitest'
import { estimateActivity } from './activity.js'
import { applyBudgets, DEFAULT_BUDGETS } from './budgets.js'
import {
  EMPTY_ACTIVITY,
  EMPTY_TRUNCATION,
  SCHEMA_VERSION,
  type GitEvidence,
  type ProjectContext,
  type ReportContext,
  type UserPrompt,
} from './model.js'

function makePrompt(minute: number, session = 's', provider = 'codex', text = 'x'): UserPrompt {
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return {
    provider,
    session_id: session,
    timestamp: `2026-07-22T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`,
    cwd: '/tmp/p',
    text,
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
    schema_version: SCHEMA_VERSION,
    report_date: '2026-07-22',
    timezone: 'Asia/Shanghai',
    project,
    prompts,
    git,
    activity_estimate: { ...EMPTY_ACTIVITY },
    warnings: [],
    truncation: { ...EMPTY_TRUNCATION },
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
  expect(context.warnings.some((w) => w.includes('prompt budget'))).toBe(true)
})

test('budget removes readme excerpt first when over total', () => {
  const context = makeContext([makePrompt(0)])
  context.project.readme_excerpt = 'x'.repeat(400)
  applyBudgets(context, { ...DEFAULT_BUDGETS, total_chars: 200, prompt_chars: 100 })
  expect(context.project.readme_excerpt).toBeNull()
  expect(context.truncation.readme_truncated).toBe(true)
})

test('budget keeps each session first prompt plus the newest records', () => {
  const prompts = [
    makePrompt(0, 's1', 'codex', 'a'),
    makePrompt(1, 's2', 'codex', 'b'),
    makePrompt(2, 's1', 'codex', 'c'),
    makePrompt(3, 's2', 'codex', 'd'),
  ]
  const context = makeContext(prompts)
  // prompt_chars=3: both firsts (a+b) and the newest overall (d) fit; c is dropped.
  applyBudgets(context, { ...DEFAULT_BUDGETS, prompt_chars: 3 })
  expect(context.prompts.map((p) => p.record_id)).toEqual(['0', '1', '3'])
  expect(context.truncation.prompts_dropped).toBe(1)
})

test('budget drops near-duplicate prompts with identical text within a session', () => {
  const prompts = [
    makePrompt(0, 's1', 'codex', 'retry the build'),
    makePrompt(1, 's1', 'codex', 'retry   the build'),
    makePrompt(2, 's2', 'codex', 'retry the build'),
  ]
  const context = makeContext(prompts)
  applyBudgets(context, DEFAULT_BUDGETS)
  expect(context.prompts.map((p) => p.record_id)).toEqual(['0', '2'])
  expect(context.truncation.prompts_dropped).toBe(1)
  expect(context.warnings.some((w) => w.includes('duplicate'))).toBe(true)
})
