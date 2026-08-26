import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { resolveWindow, type RepoQuery } from '@l5ng/yaohe-core'
import { collectRepo } from './collector.js'
import { collectGit, listWorktrees, resolveGitRoot } from './git.js'

function git(root: string, args: string[], extraEnv: Record<string, string> = {}): void {
  execFileSync('git', ['-C', root, ...args], {
    stdio: 'ignore',
    env: { ...process.env, ...extraEnv },
  })
}

function commit(root: string, message: string, date: string, author?: string): void {
  const env: Record<string, string> = {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  }
  if (author) {
    env.GIT_AUTHOR_NAME = author
    env.GIT_AUTHOR_EMAIL = `${author.toLowerCase()}@example.com`
    env.GIT_COMMITTER_NAME = author
    env.GIT_COMMITTER_EMAIL = `${author.toLowerCase()}@example.com`
  }
  git(root, ['commit', '-q', '-m', message], env)
}

function initRepo(root: string): void {
  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.name', 'Alice'])
  git(root, ['config', 'user.email', 'alice@example.com'])
}

test('filters exact author and collects working tree', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yaohe-git-'))
  initRepo(root)
  writeFileSync(join(root, 'tracked.txt'), 'one\n')
  git(root, ['add', 'tracked.txt'])
  commit(root, 'initial', '2026-07-22T08:00:00+08:00')

  writeFileSync(join(root, 'bob.txt'), 'bob\n')
  git(root, ['add', 'bob.txt'])
  commit(root, 'bob change', '2026-07-22T12:00:00+08:00', 'Bob')

  writeFileSync(join(root, 'boundary.txt'), 'next day\n')
  git(root, ['add', 'boundary.txt'])
  commit(root, 'next day boundary', '2026-07-23T00:00:00+08:00')

  writeFileSync(join(root, 'tracked.txt'), 'one\ntwo\n')
  writeFileSync(join(root, 'staged.txt'), 'staged\n')
  git(root, ['add', 'staged.txt'])
  writeFileSync(join(root, 'untracked.txt'), 'new\n')

  const window = resolveWindow('2026-07-22', 'Asia/Shanghai')
  const evidence = await collectGit(root, window, null, false, true)
  expect(evidence.commits.length).toBe(1)
  expect(evidence.commits[0].subject).toBe('initial')

  const allAuthors = await collectGit(root, window, null, true, false)
  expect(allAuthors.commits.length).toBe(2)
  expect(allAuthors.commits.some((c) => c.subject === 'bob change')).toBe(true)
  expect(allAuthors.commits.some((c) => c.subject === 'next day boundary')).toBe(false)

  const worktree = evidence.working_tree!
  expect(worktree.staged.files_changed).toBe(1)
  expect(worktree.unstaged.files_changed).toBe(1)
  expect(worktree.untracked.total).toBe(1)
})

test('lists main and linked worktrees', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yaohe-wt-'))
  const linked = join(root, 'feature-tree')
  initRepo(root)
  writeFileSync(join(root, 'tracked.txt'), 'one\n')
  git(root, ['add', 'tracked.txt'])
  commit(root, 'initial', '2026-07-22T08:00:00+08:00')
  git(root, ['worktree', 'add', '-q', '-b', 'feature/report', linked])

  const discovery = await listWorktrees(root)
  expect(discovery.warnings.length).toBe(0)
  expect(discovery.worktrees.length).toBe(2)
  expect(discovery.worktrees.some(
    (w) => w.root === realpathSync(root) && w.branch === 'main',
  )).toBe(true)
  expect(discovery.worktrees.some(
    (w) => w.root === realpathSync(linked) && w.branch === 'feature/report',
  )).toBe(true)
})

test('tracks staged renames with the full destination path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yaohe-rename-'))
  initRepo(root)
  writeFileSync(join(root, 'a.txt'), 'one\n')
  git(root, ['add', 'a.txt'])
  commit(root, 'initial', '2026-07-22T08:00:00+08:00')
  // " -> " inside the destination would be mis-split by the old line-based parser
  git(root, ['mv', 'a.txt', 'b -> c.txt'])
  writeFileSync(join(root, 'untracked.txt'), 'new\n')

  const evidence = await collectGit(
    root,
    resolveWindow('2026-07-22', 'Asia/Shanghai'),
    null,
    false,
    true,
  )
  const stagedPaths = evidence.working_tree!.staged.paths
  // --no-renames numstat counts the rename as delete(a.txt) + add(destination)
  expect(stagedPaths).toContain('b -> c.txt')
  expect(stagedPaths).not.toContain('c.txt')
  expect(evidence.working_tree!.staged.files_changed).toBe(2)
  expect(evidence.working_tree!.untracked.total).toBe(1)
})

test('keeps untracked paths containing newlines intact', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yaohe-newline-'))
  initRepo(root)
  writeFileSync(join(root, 'tracked.txt'), 'one\n')
  git(root, ['add', 'tracked.txt'])
  commit(root, 'initial', '2026-07-22T08:00:00+08:00')
  writeFileSync(join(root, 'weird\nname.txt'), 'new\n')

  const evidence = await collectGit(
    root,
    resolveWindow('2026-07-22', 'Asia/Shanghai'),
    null,
    false,
    true,
  )
  expect(evidence.working_tree!.untracked.total).toBe(1)
  expect(evidence.working_tree!.untracked.paths).toEqual(['weird\nname.txt'])
})

test('all worktrees deduplicates commits and keeps each working tree', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yaohe-wt2-'))
  const linked = join(root, 'feature-tree')
  initRepo(root)
  writeFileSync(join(root, 'tracked.txt'), 'one\n')
  git(root, ['add', 'tracked.txt'])
  commit(root, 'initial', '2026-07-22T08:00:00+08:00')
  git(root, ['worktree', 'add', '-q', '-b', 'feature/report', linked])

  writeFileSync(join(linked, 'feature.txt'), 'feature\n')
  git(linked, ['add', 'feature.txt'])
  commit(linked, 'feature change', '2026-07-22T09:00:00+08:00')
  writeFileSync(join(linked, 'untracked.txt'), 'pending\n')

  const query: RepoQuery = {
    projectInput: root,
    window: resolveWindow('2026-07-22', 'Asia/Shanghai'),
    author: null,
    allAuthors: false,
    includeUncommitted: true,
    allWorktrees: true,
    readmeChars: 12_000,
  }
  const slice = await collectRepo(query)

  expect(slice.git.commits.length).toBe(2)
  const initial = slice.git.commits.find((c) => c.subject === 'initial')!
  expect(initial.worktrees).toEqual(['feature/report', 'main'])
  const feature = slice.git.commits.find((c) => c.subject === 'feature change')!
  expect(feature.worktrees).toEqual(['feature/report'])

  expect(slice.git.worktrees.length).toBe(2)
  expect(slice.worktreeRoots.length).toBe(2)
  const featureTree = slice.git.worktrees.find((w) => w.name === 'feature/report')!
  expect(featureTree.working_tree!.untracked.total).toBe(1)
  expect(slice.project.worktree_count).toBe(2)
  expect(slice.project.all_worktrees).toBe(true)
})

test('resolves git root from subdirectory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yaohe-root-'))
  initRepo(root)
  writeFileSync(join(root, 'a.txt'), 'x\n')
  git(root, ['add', 'a.txt'])
  commit(root, 'init', '2026-07-22T08:00:00+08:00')
  const sub = join(root, 'src', 'deep')
  mkdirSync(sub, { recursive: true })
  expect(await resolveGitRoot(sub)).toBe(realpathSync(root))
})
