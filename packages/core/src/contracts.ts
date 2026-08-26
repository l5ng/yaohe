import type { GitEvidence, ProjectContext, TruncationInfo, UserPrompt } from './model.js'
import type { ReportWindow } from './time.js'

export type AgentChoice = 'auto' | 'codex' | 'claude'

export interface RepoQuery {
  projectInput: string
  window: ReportWindow
  author: string | null
  allAuthors: boolean
  includeUncommitted: boolean
  allWorktrees: boolean
  readmeChars: number
}

export interface SessionQuery {
  gitRoots: string[]
  window: ReportWindow
}

export interface RepoSlice {
  project: ProjectContext
  git: GitEvidence
  worktreeRoots: string[]
  warnings: string[]
  truncation: TruncationInfo
}

export interface SessionEvidence {
  prompts: UserPrompt[]
  warnings: string[]
}

export interface GeneratorOptions {
  timeoutSecs: number
}

export interface ReportGenerator {
  id: string
  checkAvailable(): Promise<void>
  generate(prompt: string, options: GeneratorOptions): Promise<string>
}

export type Promisable<T> = T | Promise<T>
