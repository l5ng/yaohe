import { basename, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { Context } from 'cordis'
import {
  EMPTY_TRUNCATION,
  truncateChars,
  type GitEvidence,
  type RepoQuery,
  type RepoSlice,
  type TruncationInfo,
  type WorkingTreeEvidence,
} from '@l5ng/yaohe-core'
import {
  collectGit,
  listWorktrees,
  resolveAuthorFilter,
  resolveGitRoot,
  worktreeName,
  type GitWorktree,
} from './git.js'

export const name = 'collector-git'

export const plugin = { name, apply }

export function apply(ctx: Context): void {
  ctx.on('evidence/repo', async (query) => collectRepo(query))
}

export async function collectRepo(query: RepoQuery): Promise<RepoSlice> {
  const selectedRoot = await resolveGitRoot(query.projectInput)
  const warnings: string[] = []
  const truncation: TruncationInfo = { ...EMPTY_TRUNCATION }

  let worktrees: GitWorktree[]
  if (query.allWorktrees) {
    const discovery = await listWorktrees(selectedRoot)
    warnings.push(...discovery.warnings)
    if (discovery.worktrees.length === 0) {
      throw new Error('The repository has no usable Git worktrees')
    }
    worktrees = discovery.worktrees
  } else {
    worktrees = [{ root: selectedRoot, head: null, branch: null }]
  }
  if (
    query.allWorktrees
    && !worktrees.some((worktree) => worktree.root === selectedRoot)
  ) {
    throw new Error(`Current worktree ${selectedRoot} is not listed by git worktree list`)
  }

  const projectRoot = query.allWorktrees ? worktrees[0].root : selectedRoot
  const projectName = basename(projectRoot) || 'project'
  const readmeExcerpt = await collectReadme(projectRoot, query.readmeChars, warnings, truncation)
  const git = await collectGitScope(worktrees, selectedRoot, query, warnings, truncation)

  return {
    project: {
      name: projectName,
      git_root: selectedRoot,
      readme_excerpt: readmeExcerpt,
      all_worktrees: query.allWorktrees,
      worktree_count: worktrees.length,
    },
    git,
    worktreeRoots: worktrees.map((worktree) => worktree.root),
    warnings,
    truncation,
  }
}

async function collectGitScope(
  worktrees: GitWorktree[],
  selectedRoot: string,
  query: RepoQuery,
  warnings: string[],
  truncation: TruncationInfo,
): Promise<GitEvidence> {
  if (!query.allWorktrees) {
    const evidence = await collectGit(
      selectedRoot,
      query.window,
      query.author,
      query.allAuthors,
      query.includeUncommitted,
    )
    recordUntrackedTruncation(evidence.working_tree, null, warnings, truncation)
    return evidence
  }

  const authorFilter = await resolveAuthorFilter(
    selectedRoot,
    query.author,
    query.allAuthors,
  )
  const commitsByHash = new Map<string, GitEvidence['commits'][number]>()
  const worktreeEvidence: NonNullable<GitEvidence['worktrees']> = []
  const names = uniqueWorktreeNames(worktrees)

  for (let i = 0; i < worktrees.length; i++) {
    const worktree = worktrees[i]
    const worktreeNameValue = names[i]
    let evidence: GitEvidence
    try {
      evidence = await collectGit(
        worktree.root,
        query.window,
        authorFilter,
        query.allAuthors,
        query.includeUncommitted,
      )
    } catch (error) {
      if (worktree.root === selectedRoot) throw error
      warnings.push(`Failed to collect Git evidence for worktree \`${worktreeNameValue}\`: ${(error as Error).message}`)
      worktreeEvidence.push({
        name: worktreeNameValue,
        git_root: worktree.root,
        branch: worktree.branch,
        head: worktree.head,
        working_tree: null,
      })
      continue
    }

    recordUntrackedTruncation(evidence.working_tree, worktreeNameValue, warnings, truncation)
    for (const commit of evidence.commits) {
      const existing = commitsByHash.get(commit.hash)
      if (!existing) {
        commit.worktrees.push(worktreeNameValue)
        commitsByHash.set(commit.hash, commit)
      } else if (!existing.worktrees.includes(worktreeNameValue)) {
        existing.worktrees.push(worktreeNameValue)
      }
    }
    worktreeEvidence.push({
      name: worktreeNameValue,
      git_root: worktree.root,
      branch: worktree.branch,
      head: worktree.head,
      working_tree: evidence.working_tree,
    })
  }

  const commits = [...commitsByHash.values()]
  commits.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  for (const commit of commits) commit.worktrees.sort()

  return {
    author_filter: authorFilter,
    commits,
    working_tree: null,
    worktrees: worktreeEvidence,
  }
}

function uniqueWorktreeNames(worktrees: GitWorktree[]): string[] {
  const counts = new Map<string, number>()
  return worktrees.map((worktree) => {
    const base = worktreeName(worktree)
    const count = (counts.get(base) ?? 0) + 1
    counts.set(base, count)
    return count === 1 ? base : `${base}#${count}`
  })
}

function recordUntrackedTruncation(
  workingTree: WorkingTreeEvidence | null,
  worktreeNameValue: string | null,
  warnings: string[],
  truncation: TruncationInfo,
): void {
  if (!workingTree) return
  truncation.untracked_paths_omitted += workingTree.untracked.omitted
  if (workingTree.untracked.omitted > 0) {
    const scope = worktreeNameValue ? `worktree \`${worktreeNameValue}\` ` : ''
    warnings.push(`${scope}Omitted ${workingTree.untracked.omitted} untracked path summary entries`)
  }
}

async function collectReadme(
  root: string,
  budget: number,
  warnings: string[],
  truncation: TruncationInfo,
): Promise<string | null> {
  const path = join(root, 'README.md')
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    warnings.push('Missing README.md at repository root')
    return null
  }
  text = text.trim()
  if (text === '') {
    warnings.push('README.md is empty')
    return null
  }
  const [excerpt, wasTruncated] = truncateChars(text, budget)
  if (wasTruncated) {
    truncation.readme_truncated = true
    warnings.push(`README.md was truncated to the ${budget}-character budget`)
  }
  return excerpt
}
