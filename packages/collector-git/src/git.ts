import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpathSync } from 'node:fs'
import { basename } from 'node:path'
import type { DiffSummary, GitCommit, GitEvidence, WorkingTreeEvidence } from '@l5ng/yaohe-core'
import { parseTimestamp, windowContains, type ReportWindow } from '@l5ng/yaohe-core'

const execFileAsync = promisify(execFile)
const PATH_SUMMARY_LIMIT = 100

export interface GitWorktree {
  root: string
  head: string | null
  branch: string | null
}

export interface WorktreeDiscovery {
  worktrees: GitWorktree[]
  warnings: string[]
}

export function worktreeName(worktree: GitWorktree): string {
  return worktree.branch ?? (basename(worktree.root) || 'detached-worktree')
}

export async function resolveGitRoot(projectInput: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', projectInput, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8' },
    )
    return realpathSync(stdout.trim())
  } catch (error) {
    throw new Error(
      `${projectInput} is not a Git repository: ${gitStderr(error)}`,
      { cause: error },
    )
  }
}

export async function listWorktrees(root: string): Promise<WorktreeDiscovery> {
  let output: string
  try {
    const result = await execFileAsync('git', ['-C', root, 'worktree', 'list', '--porcelain', '-z'], {
      encoding: 'utf8',
    })
    output = result.stdout
  } catch (error) {
    throw new Error(`git worktree list failed: ${gitStderr(error)}`, { cause: error })
  }
  return parseWorktreeList(output)
}

export function parseWorktreeList(text: string): WorktreeDiscovery {
  const result: WorktreeDiscovery = { worktrees: [], warnings: [] }
  interface Record {
    root: string | null
    head: string | null
    branch: string | null
    bare: boolean
    prunable: boolean
  }
  let record: Record = { root: null, head: null, branch: null, bare: false, prunable: false }

  const finish = () => {
    if (record.root === null) {
      record = { root: null, head: null, branch: null, bare: false, prunable: false }
      return
    }
    if (record.bare) {
      result.warnings.push(`Skipped bare worktree: ${record.root}`)
    } else if (record.prunable) {
      result.warnings.push(`Skipped unavailable worktree: ${record.root}`)
    } else {
      try {
        result.worktrees.push({
          root: realpathSync(record.root),
          head: record.head,
          branch: record.branch,
        })
      } catch {
        result.warnings.push(`Failed to resolve worktree ${record.root}; skipped`)
      }
    }
    record = { root: null, head: null, branch: null, bare: false, prunable: false }
  }

  for (const field of text.split('\0')) {
    if (field === '') {
      finish()
    } else if (field.startsWith('worktree ')) {
      record.root = field.slice('worktree '.length)
    } else if (field.startsWith('HEAD ')) {
      record.head = field.slice('HEAD '.length)
    } else if (field.startsWith('branch ')) {
      record.branch = field.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (field === 'bare') {
      record.bare = true
    } else if (field.startsWith('prunable')) {
      record.prunable = true
    }
  }
  if (record.root !== null) finish()
  return result
}

export async function resolveAuthorFilter(
  root: string,
  author: string | null,
  allAuthors: boolean,
): Promise<string | null> {
  if (allAuthors) return null
  const explicit = author?.trim()
  if (explicit) return explicit
  const email = (await gitConfigEmail(root))?.trim() ?? ''
  if (email === '') {
    throw new Error('Cannot determine the Git user email; configure git config user.email, or use --author / --all-authors')
  }
  return email
}

export async function collectGit(
  root: string,
  window: ReportWindow,
  author: string | null,
  allAuthors: boolean,
  includeUncommitted: boolean,
): Promise<GitEvidence> {
  const authorFilter = await resolveAuthorFilter(root, author, allAuthors)
  const commits = await collectCommits(root, window, authorFilter)
  const workingTree = includeUncommitted ? await collectWorkingTree(root) : null
  return {
    author_filter: authorFilter,
    commits,
    working_tree: workingTree,
    worktrees: [],
  }
}

async function collectCommits(
  root: string,
  window: ReportWindow,
  authorFilter: string | null,
): Promise<GitCommit[]> {
  try {
    await execFileAsync('git', ['-C', root, 'rev-parse', '--verify', 'HEAD'])
  } catch {
    return []
  }

  const format = '%H%x1f%cI%x1f%ae%x1f%s%x1e'
  const { stdout } = await execFileAsync(
    'git',
    [
      '-C', root, 'log',
      `--since=${window.start.toJSON()}`,
      `--until=${window.end.toJSON()}`,
      `--format=${format}`,
    ],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  )

  const commits: GitCommit[] = []
  for (const rawRecord of stdout.split('\x1e')) {
    const record = rawRecord.trim()
    if (record === '') continue
    const parts = record.split('\x1f')
    const [hash, timestampText, email] = parts
    const subject = parts.slice(3).join('\x1f')
    if (!hash || !timestampText || !email || subject === undefined) continue
    if (authorFilter !== null && email.trim() !== authorFilter) continue
    const instant = parseTimestamp(timestampText.trim())
    if (!instant || !windowContains(window, instant)) continue
    const stats = await commitStats(root, hash.trim())
    commits.push({
      hash: hash.trim(),
      timestamp: instant.toJSON(),
      subject: subject.trim(),
      files_changed: stats.files_changed,
      additions: stats.additions,
      deletions: stats.deletions,
      worktrees: [],
    })
  }
  commits.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return commits
}

async function commitStats(root: string, hash: string): Promise<DiffSummary> {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', root, 'show', '--format=', '--numstat', '--no-renames', hash],
    { encoding: 'utf8' },
  )
  return parseNumstat(stdout)
}

export async function collectWorkingTree(root: string): Promise<WorkingTreeEvidence> {
  const quotepath = ['-c', 'core.quotepath=false']
  const status = await runGit(root, [...quotepath, 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const stagedStat = await runGit(root, [...quotepath, 'diff', '--cached', '--numstat', '--no-renames', '--'])
  const unstagedStat = await runGit(root, [...quotepath, 'diff', '--numstat', '--no-renames', '--'])

  const staged = parseNumstat(stagedStat)
  const unstaged = parseNumstat(unstagedStat)
  const untrackedPaths: string[] = []
  const stagedStatusPaths = new Set<string>()
  const unstagedStatusPaths = new Set<string>()

  // porcelain v1 -z: NUL-terminated records; rename/copy entries are "to\0from\0"
  // (field order reversed from the "from -> to" display), so the current record
  // holds the destination and the next record is the origin to skip.
  const records = status.split('\0')
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (record.length < 3) continue
    const x = record[0]
    const y = record[1]
    const path = record.slice(3)
    if (x === 'R' || x === 'C') i++
    if (x === '?' && y === '?') {
      untrackedPaths.push(path)
      continue
    }
    if (x !== ' ' && x !== '?') stagedStatusPaths.add(path)
    if (y !== ' ' && y !== '?') unstagedStatusPaths.add(path)
  }

  mergeStatusPaths(staged, stagedStatusPaths)
  mergeStatusPaths(unstaged, unstagedStatusPaths)
  untrackedPaths.sort()
  const total = untrackedPaths.length
  const paths = [...new Set(untrackedPaths)].slice(0, PATH_SUMMARY_LIMIT)

  return {
    staged,
    unstaged,
    untracked: { total, paths, omitted: total - paths.length },
  }
}

export function parseNumstat(text: string): DiffSummary {
  const summary: DiffSummary = { files_changed: 0, additions: 0, deletions: 0, paths: [] }
  const paths = new Set<string>()
  for (const line of text.split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const [additions, deletions, path] = parts
    summary.additions += Number.parseInt(additions, 10) || 0
    summary.deletions += Number.parseInt(deletions, 10) || 0
    paths.add(path)
  }
  summary.paths = [...paths]
  summary.files_changed = summary.paths.length
  return summary
}

function mergeStatusPaths(summary: DiffSummary, extra: Set<string>): void {
  const paths = new Set(summary.paths)
  for (const path of extra) paths.add(path)
  summary.paths = [...paths]
  summary.files_changed = summary.paths.length
}

async function gitConfigEmail(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'config', 'user.email'], {
      encoding: 'utf8',
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function runGit(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
    encoding: 'utf8',
  })
  return stdout
}

function gitStderr(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr?.trim()
  return stderr && stderr !== '' ? stderr : (error as Error).message
}
