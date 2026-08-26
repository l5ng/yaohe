import { Context } from 'cordis'
import { LoggerService } from '@l5ng/yaohe-core'
import { plugin as gitCollector } from '@l5ng/yaohe-collector-git'
import { claudePlugin as claudeCollector, codexPlugin as codexCollector } from '@l5ng/yaohe-collector-sessions'
import { plugin as claudeGenerator } from '@l5ng/yaohe-generator-claude'
import { plugin as codexGenerator } from '@l5ng/yaohe-generator-codex'
import type { EffectiveConfig } from './config.js'
import { ReportPipelineService } from './pipeline.js'

export async function run(effective: EffectiveConfig): Promise<void> {
  // cordis' built-in logger (reggol) writes to stdout and would pollute the report;
  // silence it and route logging through yaoheLog instead
  process.env.LOG_LEVEL ??= 'silent'
  const ctx = new Context()
  ctx.plugin(LoggerService, {
    level: effective.verbosity >= 2 ? 'debug' : effective.verbosity >= 1 ? 'info' : 'warn',
    file: effective.logFile ?? undefined,
  })
  ctx.plugin(gitCollector)
  ctx.plugin(claudeCollector)
  ctx.plugin(codexCollector)
  ctx.plugin(codexGenerator, { command: 'codex' })
  ctx.plugin(claudeGenerator, { command: 'claude' })
  ctx.plugin(ReportPipelineService)
  await ctx.reportPipeline.run(effective)
}
