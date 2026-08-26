/** Field names use snake_case so dump-context output stays stable and machine-comparable. */

export interface ReportContext {
  schema_version: number
  report_date: string
  timezone: string
  project: ProjectContext
  prompts: UserPrompt[]
  git: GitEvidence
  activity_estimate: ActivityEstimate
  warnings: string[]
  truncation: TruncationInfo
}

export interface ProjectContext {
  name: string
  git_root: string
  readme_excerpt: string | null
  all_worktrees: boolean
  worktree_count: number
}

export interface UserPrompt {
  provider: string
  session_id: string
  /** RFC3339 UTC, e.g. 2026-07-22T01:00:00.000Z */
  timestamp: string
  cwd: string
  text: string
  record_id: string
}

export interface GitEvidence {
  author_filter: string | null
  commits: GitCommit[]
  working_tree: WorkingTreeEvidence | null
  worktrees: GitWorktreeEvidence[]
}

export interface GitCommit {
  hash: string
  timestamp: string
  subject: string
  files_changed: number
  additions: number
  deletions: number
  worktrees: string[]
}

export interface GitWorktreeEvidence {
  name: string
  git_root: string
  branch: string | null
  head: string | null
  working_tree: WorkingTreeEvidence | null
}

export interface WorkingTreeEvidence {
  staged: DiffSummary
  unstaged: DiffSummary
  untracked: FileListSummary
}

export interface DiffSummary {
  files_changed: number
  additions: number
  deletions: number
  paths: string[]
}

export interface FileListSummary {
  total: number
  paths: string[]
  omitted: number
}

export interface ActivityEstimate {
  estimated_minutes: number
  has_duration_evidence: boolean
  segments: number
  prompt_events: number
  is_estimate: boolean
  method: string
}

export interface TruncationInfo {
  readme_truncated: boolean
  prompts_dropped: number
  prompt_texts_truncated: number
  untracked_paths_omitted: number
}

export const EMPTY_ACTIVITY: ActivityEstimate = {
  estimated_minutes: 0,
  has_duration_evidence: false,
  segments: 0,
  prompt_events: 0,
  is_estimate: false,
  method: '',
}

export const EMPTY_TRUNCATION: TruncationInfo = {
  readme_truncated: false,
  prompts_dropped: 0,
  prompt_texts_truncated: 0,
  untracked_paths_omitted: 0,
}
