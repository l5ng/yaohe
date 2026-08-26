import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import { Schema } from 'cordis'
import {
  DEFAULT_BUDGETS,
  type AgentChoice,
  type ContextBudgets,
  type TemplateLanguage,
  type TemplateLanguageChoice,
  YaoheError,
  detectUserLanguage,
} from '@l5ng/yaohe-core'
import type { CliValues } from './args.js'

export interface FileConfig {
  agent?: string
  timezone?: string
  template?: string
  template_lang?: string
  output?: string
  include_uncommitted?: boolean
  timeout?: number
  log_file?: string
  context_budget_chars?: number
  prompt_budget_chars?: number
  readme_budget_chars?: number
  max_prompts?: number
}

export interface EffectiveConfig {
  project: string
  allWorktrees: boolean
  date: string | null
  agent: AgentChoice
  template: string | null
  templateLang: TemplateLanguage
  output: string | null
  author: string | null
  allAuthors: boolean
  includeUncommitted: boolean
  dryRun: boolean
  dumpContext: string | null
  logFile: string | null
  timeoutSecs: number
  force: boolean
  verbosity: number
  timezone: string | null
  budgets: ContextBudgets
}

const FileConfigSchema = Schema.object({
  agent: Schema.union(['auto', 'codex', 'claude'] as const),
  timezone: Schema.string(),
  template: Schema.string(),
  template_lang: Schema.union(['en', 'zh', 'auto'] as const),
  output: Schema.string(),
  include_uncommitted: Schema.boolean(),
  timeout: Schema.natural().min(1).max(86400),
  log_file: Schema.string(),
  context_budget_chars: Schema.natural().min(4096),
  prompt_budget_chars: Schema.natural().min(1024),
  readme_budget_chars: Schema.natural().min(256),
  max_prompts: Schema.natural().min(1),
})

type FileConfigInput = Parameters<typeof FileConfigSchema>[0]

function configPath(): string {
  if (process.env.YAOHE_CONFIG) return process.env.YAOHE_CONFIG
  const home = homedir()
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'yaohe', 'config.toml')
    case 'win32':
      return join(process.env.APPDATA ?? home, 'yaohe', 'config.toml')
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'yaohe', 'config.toml')
  }
}

export function loadFileConfig(): FileConfig {
  const path = configPath()
  if (!existsSync(path)) return {}
  let parsed: Record<string, unknown>
  try {
    parsed = parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new YaoheError(
      `Failed to parse config file ${path}: ${(error as Error).message}`,
      'CONFIG_INVALID',
      { cause: error },
    )
  }

  const stringKeys = ['agent', 'timezone', 'template', 'template_lang', 'output', 'log_file'] as const
  const numberKeys = [
    'timeout',
    'context_budget_chars',
    'prompt_budget_chars',
    'readme_budget_chars',
    'max_prompts',
  ] as const
  const result: FileConfig = {}
  for (const key of stringKeys) {
    const value = parsed[key]
    if (typeof value === 'string') result[key] = value
  }
  for (const key of numberKeys) {
    const value = parsed[key]
    if (typeof value === 'number') result[key] = value
  }
  const includeUncommitted = parsed.include_uncommitted
  if (typeof includeUncommitted === 'boolean') result.include_uncommitted = includeUncommitted
  return result
}

export function buildEffectiveConfig(cli: CliValues, file: FileConfig): EffectiveConfig {
  let validated: ReturnType<typeof FileConfigSchema>
  try {
    validated = FileConfigSchema(file as FileConfigInput)
  } catch (error) {
    throw new YaoheError(`Invalid config: ${(error as Error).message}`, 'CONFIG_INVALID', {
      cause: error,
    })
  }
  const agent = cli.agent ?? validated.agent ?? 'auto'
  const defaults = DEFAULT_BUDGETS
  const budgets: ContextBudgets = {
    total_chars: Math.max(validated.context_budget_chars ?? defaults.total_chars, 4_096),
    prompt_chars: Math.max(validated.prompt_budget_chars ?? defaults.prompt_chars, 1_024),
    readme_chars: Math.max(validated.readme_budget_chars ?? defaults.readme_chars, 256),
    max_prompts: Math.max(validated.max_prompts ?? defaults.max_prompts, 1),
  }
  return {
    project: cli.project,
    allWorktrees: cli.allWorktrees,
    date: cli.date,
    agent,
    template: cli.template ?? validated.template ?? null,
    templateLang: resolveTemplateLang(cli.templateLang ?? validated.template_lang),
    output: cli.output ?? validated.output ?? null,
    author: cli.author,
    allAuthors: cli.allAuthors,
    includeUncommitted: cli.noUncommitted ? false : (validated.include_uncommitted ?? true),
    dryRun: cli.dryRun,
    dumpContext: cli.dumpContext,
    logFile: cli.logFile ?? validated.log_file ?? null,
    timeoutSecs: clampTimeout(cli.timeout ?? validated.timeout ?? 300),
    force: cli.force,
    verbosity: cli.verbosity,
    timezone: validated.timezone ?? null,
    budgets,
  }
}

function clampTimeout(value: number): number {
  return Math.min(Math.max(value, 1), 86_400)
}

function resolveTemplateLang(value: TemplateLanguageChoice | undefined): TemplateLanguage {
  if (value === 'en' || value === 'zh') return value
  return detectUserLanguage()
}
