import { realpathSync } from 'node:fs'
import { Service, type Context } from 'cordis'
import {
  applyBudgets,
  buildGenerationPrompt,
  estimateActivity,
  loadTemplate,
  resolveWindow,
  writeOutput,
  YaoheError,
  SCHEMA_VERSION,
  type ReportContext,
  type SessionEvidence,
  type UserPrompt,
} from '@l5ng/yaohe-core'
import type { EffectiveConfig } from './config.js'

export class NoActivityError extends YaoheError {
  constructor() {
    super('No collectable activity', 'NO_ACTIVITY')
  }
}

export class ReportPipelineService extends Service {
  static inject = ['yaoheLog']

  constructor(ctx: Context) {
    super(ctx, 'reportPipeline', true)
  }

  run(effective: EffectiveConfig): Promise<void> {
    return runReport(this.ctx, effective)
  }
}

declare module 'cordis' {
  interface Context {
    reportPipeline: ReportPipelineService
  }
}

async function runReport(ctx: Context, effective: EffectiveConfig): Promise<void> {
  let projectInput: string
  try {
    projectInput = realpathSync(effective.project)
  } catch {
    throw new YaoheError(`Cannot access project directory ${effective.project}`, 'COLLECTION_FAILED')
  }

  const window = resolveWindow(effective.date ?? undefined, effective.timezone ?? undefined)
  const repo = await ctx.serial('evidence/repo', {
    projectInput,
    window,
    author: effective.author,
    allAuthors: effective.allAuthors,
    includeUncommitted: effective.includeUncommitted,
    allWorktrees: effective.allWorktrees,
    readmeChars: effective.budgets.readme_chars,
  })
  if (!repo) {
    throw new YaoheError('No repo collector registered', 'COLLECTION_FAILED')
  }
  const sessionEvidence: SessionEvidence = { prompts: [], warnings: [] }
  await ctx.serial('evidence/session', { gitRoots: repo.worktreeRoots, window }, sessionEvidence)

  const prompts = deduplicateAndSort([...sessionEvidence.prompts])
  const context: ReportContext = {
    schema_version: SCHEMA_VERSION,
    report_date: window.date,
    timezone: window.timezone,
    project: repo.project,
    prompts,
    git: repo.git,
    activity_estimate: estimateActivity(prompts),
    warnings: [...repo.warnings, ...sessionEvidence.warnings],
    truncation: repo.truncation,
  }
  applyBudgets(context, effective.budgets)

  if (effective.dumpContext !== null) {
    writeOutput(effective.dumpContext, `${JSON.stringify(context, null, 2)}\n`, effective.force)
    ctx.yaoheLog.info(`Context written to ${effective.dumpContext}`)
  }

  if (!hasActivity(context)) {
    throw new NoActivityError()
  }

  const template = await loadTemplate(
    effective.template ?? undefined,
    context.report_date,
    context.project.name,
    effective.templateLang,
  )
  const prompt = buildGenerationPrompt(context, template, effective.budgets)

  for (const warning of context.warnings) {
    ctx.yaoheLog.warn(warning)
  }

  if (effective.dryRun) {
    process.stdout.write(prompt)
    return
  }

  const errors: string[] = []
  const generator = await ctx.serial('generator/select', effective.agent, errors)
  if (!generator) {
    const message = effective.agent === 'auto'
      ? 'No usable Codex or Claude CLI found; install and sign in to one, or use --agent to choose'
      : errors.join('; ') || `No generator available for ${effective.agent}`
    throw new YaoheError(message, 'GENERATOR_FAILED')
  }
  ctx.yaoheLog.info(`Invoking report generator: ${generator.id}`)
  const report = (await generator.generate(prompt, { timeoutSecs: effective.timeoutSecs })).trim()
  if (report === '') {
    throw new YaoheError('The generator returned an empty report', 'GENERATOR_FAILED')
  }

  if (effective.output !== null) {
    writeOutput(effective.output, report, effective.force)
    ctx.yaoheLog.info(`Report written to ${effective.output}`)
  } else {
    process.stdout.write(`${report}\n`)
  }
}

function deduplicateAndSort(prompts: UserPrompt[]): UserPrompt[] {
  const seen = new Set<string>()
  const unique = prompts.filter((prompt) => {
    const key = `${prompt.provider}\0${prompt.session_id}\0${prompt.timestamp}\0${prompt.record_id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  unique.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return unique
}

function hasActivity(context: ReportContext): boolean {
  if (context.git.commits.length > 0 || context.prompts.length > 0) return true
  if (context.git.working_tree && hasWorkingTreeChanges(context.git.working_tree)) return true
  return context.git.worktrees.some(
    (worktree) => worktree.working_tree && hasWorkingTreeChanges(worktree.working_tree),
  )
}

function hasWorkingTreeChanges(workingTree: {
  staged: { files_changed: number }
  unstaged: { files_changed: number }
  untracked: { total: number }
}): boolean {
  return workingTree.staged.files_changed > 0
    || workingTree.unstaged.files_changed > 0
    || workingTree.untracked.total > 0
}
