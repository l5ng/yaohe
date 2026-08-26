import type { AgentChoice, Promisable, RepoQuery, RepoSlice, ReportGenerator, SessionEvidence, SessionQuery } from './contracts.js'

declare module 'cordis' {
  interface Events {
    /** Repo-level evidence: the first non-null result wins (ctx.serial). */
    'evidence/repo'(query: RepoQuery): Promisable<RepoSlice | null>
    /** Session evidence: every listener contributes into the shared accumulator (ctx.serial). */
    'evidence/session'(query: SessionQuery, acc: SessionEvidence): void
    /** Generator selection: the first usable generator wins; unavailable listeners report why (ctx.serial). */
    'generator/select'(choice: AgentChoice, errors: string[]): Promisable<ReportGenerator | null>
  }
}
