import { expect, test } from 'vitest'
import { DEFAULT_BUDGETS } from './budgets.js'
import {
  manyCommitsContext,
  mixedDayContext,
  multiWorktreeContext,
  promptsOnlyContext,
  readmeHeavyContext,
} from './fixtures/contexts.js'
import type { ReportContext } from './model.js'
import { buildGenerationPrompt } from './prompt.js'

const TEMPLATE = [
  '# {{date}} Daily Report',
  '',
  '## {{project}}',
  '',
  '### Completed',
  '',
  '### Blockers',
  '',
  '### Effort',
].join('\n')

const SCENARIOS: ReadonlyArray<[string, () => ReportContext]> = [
  ['mixed day', mixedDayContext],
  ['prompts-only day', promptsOnlyContext],
  ['multi-worktree day', multiWorktreeContext],
  ['README-heavy day', readmeHeavyContext],
  ['huge Git evidence', () => manyCommitsContext(1800)],
]

function estimateTokens(text: string): number {
  const chars = Array.from(text)
  const cjk = chars.filter((char) => /\p{Script=Han}/u.test(char)).length
  return Math.ceil(cjk / 1.5 + (chars.length - cjk) / 4)
}

for (const [name, make] of SCENARIOS) {
  test(`eval baseline: ${name} stays within the total budget and stays pruned`, () => {
    const prompt = buildGenerationPrompt(make(), TEMPLATE, DEFAULT_BUDGETS)
    const open = '<report_context>'
    const close = '</report_context>'
    const start = prompt.indexOf(open) + open.length
    const end = prompt.indexOf(close)
    const body = prompt.slice(start, end)

    expect(body.length).toBeLessThanOrEqual(DEFAULT_BUDGETS.total_chars)
    for (const forbidden of [
      'session_id',
      'record_id',
      'git_root',
      'author_filter',
      'schema_version',
      '/tmp/demo',
    ]) {
      expect(body).not.toContain(forbidden)
    }
    expect(body).not.toMatch(/\b[0-9a-f]{40}\b/)

    process.stdout.write(
      `[eval] ${name}: context ${body.length} chars ≈ ${estimateTokens(body)} tokens `
      + `(budget ${DEFAULT_BUDGETS.total_chars} chars)\n`,
    )
  })
}
