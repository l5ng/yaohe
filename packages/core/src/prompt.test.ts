import { expect, test } from 'vitest'
import { buildGenerationPrompt } from './prompt.js'
import {
  EMPTY_ACTIVITY,
  EMPTY_TRUNCATION,
  type GitEvidence,
  type ProjectContext,
  type ReportContext,
} from './model.js'

test('prompt encodes evidence rules', () => {
  const prompt = buildGenerationPrompt(makeContext(), '# report')
  expect(prompt).toContain('Git commits > uncommitted changes summary > user prompts > README')
  expect(prompt).toContain('cannot by themselves prove that work is complete')
  expect(prompt).toContain('Return only the final Markdown')
  expect(prompt).toContain('"schema_version": 2')
})

test('prompt follows the template language', () => {
  const english = buildGenerationPrompt(makeContext(), '# Daily Report')
  expect(english).toContain('rigorous English daily report editor')

  const chinese = buildGenerationPrompt(makeContext(), '# 日报')
  expect(chinese).toContain('严谨的中文研发日报编辑器')
  expect(chinese).toContain('不能单独证明工作已经完成')
  expect(chinese).toContain('只返回最终 Markdown')
  expect(chinese).toContain('结构化上下文')
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
    schema_version: 2,
    report_date: '2026-07-22',
    timezone: 'Asia/Shanghai',
    project,
    prompts: [],
    git,
    activity_estimate: EMPTY_ACTIVITY,
    warnings: [],
    truncation: EMPTY_TRUNCATION,
  }
}
