import { DEFAULT_BUDGETS, truncateChars, type ContextBudgets } from './budgets.js'
import type {
  DiffSummary,
  FileListSummary,
  GitCommit,
  ReportContext,
  WorkingTreeEvidence,
} from './model.js'
import { parseTimestamp } from './time.js'

const SUBJECT_LIMIT = 140
const PATH_LIST_LIMIT = 50

interface RenderOptions {
  includeReadme: boolean
  includeUntrackedPaths: boolean
  includeDiffPaths: boolean
  includeWorktreeWorkingTrees: boolean
  includeCommitStats: boolean
}

const FULL_OPTIONS: RenderOptions = {
  includeReadme: true,
  includeUntrackedPaths: true,
  includeDiffPaths: true,
  includeWorktreeWorkingTrees: true,
  includeCommitStats: true,
}

const DEGRADATION_STEPS: ReadonlyArray<{
  label: string
  apply: (options: RenderOptions) => void
}> = [
  { label: 'removed the README excerpt', apply: (options) => { options.includeReadme = false } },
  { label: 'omitted untracked path lists (kept totals)', apply: (options) => { options.includeUntrackedPaths = false } },
  { label: 'omitted staged/unstaged path lists (kept counts)', apply: (options) => { options.includeDiffPaths = false } },
  { label: 'omitted per-worktree working-tree detail', apply: (options) => { options.includeWorktreeWorkingTrees = false } },
  { label: 'omitted per-commit stats (kept subjects)', apply: (options) => { options.includeCommitStats = false } },
]

/**
 * Render the model-facing context as a compact, pruned text document.
 * The internal record is never mutated here; degradation only affects the
 * rendered output and is reported through `warnings` when provided.
 */
export function renderGenerationContext(
  context: ReportContext,
  budgets: ContextBudgets = DEFAULT_BUDGETS,
  warnings?: string[],
): string {
  const options: RenderOptions = { ...FULL_OPTIONS }
  let text = renderAt(context, options)
  const applied: string[] = []

  for (const step of DEGRADATION_STEPS) {
    if (text.length <= budgets.total_chars) break
    step.apply(options)
    const next = renderAt(context, options)
    if (next.length < text.length) {
      applied.push(step.label)
      text = next
    }
  }

  let droppedCommits = 0
  while (text.length > budgets.total_chars && context.git.commits.length - droppedCommits > 1) {
    droppedCommits += 1
    text = renderAt(context, options, context.git.commits.length - droppedCommits)
  }
  if (droppedCommits > 0) {
    applied.push(`omitted ${droppedCommits} oldest commit(s)`)
  }

  if (warnings && applied.length > 0) {
    warnings.push(`Model context exceeded the total character budget; ${applied.join('; ')}`)
  }
  return text
}

function renderAt(
  context: ReportContext,
  options: RenderOptions,
  commitLimit = context.git.commits.length,
): string {
  const lines: string[] = [
    `Report date: ${context.report_date} (${context.timezone})`,
    `Project: ${context.project.name}`,
    '',
  ]

  const commits = context.git.commits.slice(-commitLimit)
  if (commits.length > 0) {
    lines.push(`Commits (${commits.length}):`)
    for (const commit of commits) lines.push(renderCommit(commit, options))
    lines.push('')
  }

  if (context.git.working_tree && hasWorkingTreeChanges(context.git.working_tree)) {
    lines.push('Uncommitted changes:')
    pushWorkingTree(lines, context.git.working_tree, options, '')
    lines.push('')
  } else if (options.includeWorktreeWorkingTrees) {
    const worktreeChanges: Array<{
      name: string
      branch: string | null
      workingTree: WorkingTreeEvidence
    }> = []
    for (const worktree of context.git.worktrees) {
      if (worktree.working_tree && hasWorkingTreeChanges(worktree.working_tree)) {
        worktreeChanges.push({
          name: worktree.name,
          branch: worktree.branch,
          workingTree: worktree.working_tree,
        })
      }
    }
    if (worktreeChanges.length > 0) {
      lines.push('Uncommitted changes (worktrees):')
      for (const worktree of worktreeChanges) {
        lines.push(`Worktree ${worktree.name} (${worktree.branch ?? 'detached'}):`)
        pushWorkingTree(lines, worktree.workingTree, options, '  ')
      }
      lines.push('')
    }
  }

  if (context.prompts.length > 0) {
    lines.push(`User prompts (${context.prompts.length}):`)
    for (const prompt of context.prompts) {
      const time = hhmmBracket(prompt.timestamp)
      const text = prompt.text.replace(/\s+/g, ' ').trim()
      lines.push(`- ${time ? `${time} ` : ''}(${prompt.provider}) ${text}`)
    }
    lines.push('')
  }

  lines.push(`Estimated activity: ${activityLine(context)}`)
  lines.push('')

  if (options.includeReadme && context.project.readme_excerpt !== null) {
    lines.push('README excerpt (project background):')
    lines.push(context.project.readme_excerpt.trim())
    lines.push('')
  }

  return lines.join('\n')
}

function renderCommit(commit: GitCommit, options: RenderOptions): string {
  const time = hhmmBracket(commit.timestamp)
  const [subject] = truncateChars(commit.subject, SUBJECT_LIMIT)
  let line = `- ${time ? `${time} ` : ''}${subject}`
  if (options.includeCommitStats) {
    const files = `${commit.files_changed} file${commit.files_changed === 1 ? '' : 's'}`
    line += ` (+${commit.additions} -${commit.deletions}, ${files})`
  }
  if (commit.worktrees.length > 1) {
    line += ` (worktrees: ${commit.worktrees.join(', ')})`
  }
  return line
}

function pushWorkingTree(
  lines: string[],
  workingTree: WorkingTreeEvidence,
  options: RenderOptions,
  indent: string,
): void {
  pushDiffSummary(lines, `${indent}- staged`, workingTree.staged, options)
  pushDiffSummary(lines, `${indent}- unstaged`, workingTree.unstaged, options)
  pushUntracked(lines, `${indent}- untracked`, workingTree.untracked, options)
}

function pushDiffSummary(
  lines: string[],
  label: string,
  summary: DiffSummary,
  options: RenderOptions,
): void {
  if (summary.files_changed === 0) return
  let line = `${label}: ${summary.files_changed} file(s) (+${summary.additions} -${summary.deletions})`
  if (options.includeDiffPaths && summary.paths.length > 0) {
    line += `: ${renderPathList(summary.paths, summary.paths.length)}`
  }
  lines.push(line)
}

function pushUntracked(
  lines: string[],
  label: string,
  untracked: FileListSummary,
  options: RenderOptions,
): void {
  if (untracked.total === 0) return
  let line = `${label}: ${untracked.total} path(s)`
  if (options.includeUntrackedPaths && untracked.paths.length > 0) {
    line += `: ${renderPathList(untracked.paths, untracked.total)}`
  }
  lines.push(line)
}

function renderPathList(paths: string[], total: number): string {
  const shown = paths.slice(0, PATH_LIST_LIMIT)
  const more = total - shown.length
  return `${shown.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`
}

function activityLine(context: ReportContext): string {
  const { activity_estimate: estimate } = context
  if (!estimate.has_duration_evidence) return 'no verifiable record'
  const minutes = `${estimate.estimated_minutes} minute${estimate.estimated_minutes === 1 ? '' : 's'}`
  const label = estimate.is_estimate ? ' (estimate; derived from user prompt timestamps)' : ''
  return `${minutes}${label}`
}

function hasWorkingTreeChanges(workingTree: WorkingTreeEvidence): boolean {
  return workingTree.staged.files_changed > 0
    || workingTree.unstaged.files_changed > 0
    || workingTree.untracked.total > 0
}

function hhmmBracket(iso: string): string {
  const instant = parseTimestamp(iso)
  if (!instant) return ''
  return `[${new Date(instant.epochMilliseconds).toISOString().slice(11, 16)}Z]`
}
