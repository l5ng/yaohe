import {
  EMPTY_ACTIVITY,
  EMPTY_TRUNCATION,
  SCHEMA_VERSION,
  type GitCommit,
  type ReportContext,
  type UserPrompt,
} from '../model.js'

function hhmm(minute: number): string {
  const hours = Math.floor(minute / 60)
  const mins = minute % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

export function makePrompt(
  minute: number,
  session = 's1',
  provider = 'codex',
  text = 'x',
): UserPrompt {
  return {
    provider,
    session_id: session,
    timestamp: `2026-07-22T${hhmm(minute)}:00Z`,
    cwd: '/tmp/demo',
    text,
    record_id: `${session}-${minute}`,
  }
}

function makeCommit(
  minute: number,
  subject: string,
  additions = 10,
  deletions = 2,
  files = 1,
): GitCommit {
  return {
    hash: `f${String(minute).padStart(39, '0')}`,
    timestamp: `2026-07-22T${hhmm(minute)}:00Z`,
    subject,
    files_changed: files,
    additions,
    deletions,
    worktrees: [],
  }
}

function baseContext(): ReportContext {
  return {
    schema_version: SCHEMA_VERSION,
    report_date: '2026-07-22',
    timezone: 'Asia/Shanghai',
    project: {
      name: 'demo',
      git_root: '/tmp/demo',
      readme_excerpt: null,
      all_worktrees: false,
      worktree_count: 1,
    },
    prompts: [],
    git: {
      author_filter: null,
      commits: [],
      working_tree: null,
      worktrees: [],
    },
    activity_estimate: { ...EMPTY_ACTIVITY },
    warnings: [],
    truncation: { ...EMPTY_TRUNCATION },
  }
}

/** A mixed day: commits, uncommitted changes, prompts, and a README excerpt. */
export function mixedDayContext(): ReportContext {
  const context = baseContext()
  context.project.readme_excerpt =
    'yaohe is a TypeScript CLI that generates engineering daily reports from Git evidence and AI session prompts.'
  context.git.commits = [
    makeCommit(540, 'Add budget trimming for the report context', 120, 30, 6),
    makeCommit(620, 'Fix the README badge link', 1, 1, 1),
  ]
  context.git.working_tree = {
    staged: {
      files_changed: 2,
      additions: 10,
      deletions: 2,
      paths: ['src/prompt.ts', 'packages/core/src/model.ts'],
    },
    unstaged: { files_changed: 1, additions: 3, deletions: 1, paths: ['README.md'] },
    untracked: { total: 2, paths: ['notes/todo.md', 'scratch/log.txt'], omitted: 0 },
  }
  context.prompts = [
    makePrompt(500, 's1', 'codex', 'Implement budget trimming for the report context'),
    makePrompt(560, 's2', 'claude', 'Fix the README badge link'),
  ]
  context.activity_estimate = {
    estimated_minutes: 96,
    has_duration_evidence: true,
    segments: 2,
    prompt_events: 2,
    is_estimate: true,
    method: 'fixture',
  }
  return context
}

/** A prompts-only day with no Git evidence at all. */
export function promptsOnlyContext(): ReportContext {
  const context = baseContext()
  context.prompts = [
    makePrompt(90, 's1', 'codex', 'Discuss adding a template-language flag'),
    makePrompt(130, 's1', 'codex', 'Where should the flag be documented?'),
  ]
  return context
}

/** An all-worktrees day: deduplicated commits plus per-worktree uncommitted evidence. */
export function multiWorktreeContext(): ReportContext {
  const context = baseContext()
  context.project.all_worktrees = true
  context.project.worktree_count = 2
  const commit = makeCommit(480, 'Extract shared session parsers', 45, 12, 4)
  commit.worktrees = ['main', 'feature']
  context.git.commits = [commit]
  context.git.working_tree = null
  context.git.worktrees = [
    {
      name: 'main',
      git_root: '/tmp/demo',
      branch: 'main',
      head: null,
      working_tree: {
        staged: { files_changed: 1, additions: 5, deletions: 0, paths: ['packages/core/src/model.ts'] },
        unstaged: { files_changed: 0, additions: 0, deletions: 0, paths: [] },
        untracked: { total: 1, paths: ['scratch/notes.md'], omitted: 0 },
      },
    },
    {
      name: 'feature',
      git_root: '/tmp/demo-feature',
      branch: 'feature',
      head: null,
      working_tree: {
        staged: { files_changed: 0, additions: 0, deletions: 0, paths: [] },
        unstaged: { files_changed: 2, additions: 8, deletions: 3, paths: ['src/cli.ts', 'src/args.ts'] },
        untracked: { total: 0, paths: [], omitted: 0 },
      },
    },
  ]
  context.prompts = [makePrompt(430, 's1', 'codex', 'Extract shared session parsers')]
  return context
}

/** A day with a long README excerpt (badge noise already stripped upstream). */
export function readmeHeavyContext(): ReportContext {
  const context = mixedDayContext()
  context.project.readme_excerpt =
    'This repository contains a command-line tool plus collector and generator packages. '
    + 'It is built on the Cordis plugin framework. '.repeat(120)
  return context
}

/** A day with many commits, used to exercise total-budget degradation. */
export function manyCommitsContext(count: number): ReportContext {
  const context = baseContext()
  context.git.commits = Array.from({ length: count }, (_, index) =>
    makeCommit(index % 1440, `Subject ${index}: ${'x'.repeat(80)}`, 10, 2, 3))
  return context
}
