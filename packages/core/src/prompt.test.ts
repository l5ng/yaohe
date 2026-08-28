import { expect, test } from 'vitest'
import { mixedDayContext } from './fixtures/contexts.js'
import { buildGenerationPrompt } from './prompt.js'
import {
  EMPTY_ACTIVITY,
  EMPTY_TRUNCATION,
  SCHEMA_VERSION,
  type GitEvidence,
  type ProjectContext,
  type ReportContext,
} from './model.js'

test('prompt encodes evidence rules and examples', () => {
  const prompt = buildGenerationPrompt(makeContext(), '# report')
  expect(prompt).toContain('Evidence priority is strictly: Git commits > uncommitted changes > user prompts > README')
  expect(prompt).toContain('cannot prove completion by themselves')
  expect(prompt).toContain('No explicit blockers')
  expect(prompt).toContain('## Examples')
  expect(prompt).toContain('Example 1')
  expect(prompt).toContain('Return only the final Markdown')
  expect(prompt).toContain('<report_context>')
})

test('prompt follows the template language', () => {
  const english = buildGenerationPrompt(makeContext(), '# Daily Report')
  expect(english).toContain('rigorous English daily report editor')
  expect(english).toContain('## Examples')

  const chinese = buildGenerationPrompt(makeContext(), '# 日报')
  expect(chinese).toContain('严谨的中文研发日报编辑器')
  expect(chinese).toContain('不能单独证明工作已经完成')
  expect(chinese).toContain('## 示例')
  expect(chinese).toContain('示例 1')
  expect(chinese).toContain('只返回最终 Markdown')
  expect(chinese).toContain('结构化上下文')
})

test('prompt renders a pruned context without internal or sensitive fields', () => {
  const prompt = buildGenerationPrompt(mixedDayContext(), '# Daily Report')
  expect(prompt).toContain('Commits (2):')
  expect(prompt).toContain('User prompts (2):')
  expect(prompt).not.toContain('session_id')
  expect(prompt).not.toContain('record_id')
  expect(prompt).not.toContain('git_root')
  expect(prompt).not.toContain('author_filter')
  expect(prompt).not.toContain('schema_version')
  expect(prompt).not.toContain('/tmp/demo')
  expect(prompt).not.toMatch(/\b[0-9a-f]{40}\b/)
})

function makeContext(): ReportContext {
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
    prompts: [],
    git,
    activity_estimate: { ...EMPTY_ACTIVITY },
    warnings: [],
    truncation: { ...EMPTY_TRUNCATION },
  }
}
