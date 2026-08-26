import { readFileSync } from 'node:fs'
import { Command, InvalidArgumentError, Option } from 'commander'
import type { AgentChoice, TemplateLanguageChoice } from '@l5ng/yaohe-core'

export interface CliValues {
  command: string
  project: string
  allWorktrees: boolean
  date: string | null
  author: string | null
  allAuthors: boolean
  noUncommitted: boolean
  agent: AgentChoice | null
  template: string | null
  templateLang: TemplateLanguageChoice | null
  timeout: number | null
  output: string | null
  force: boolean
  dryRun: boolean
  dumpContext: string | null
  logFile: string | null
  verbosity: number
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: string }
    return `yaohe ${pkg.version ?? ''}`.trim()
  } catch {
    return 'yaohe'
  }
}

function parseTimeout(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 86_400) {
    throw new InvalidArgumentError(
      `expected an integer between 1 and 86400 seconds, got "${value}"`,
    )
  }
  return parsed
}

function countVerbose(_value: unknown, previous: number): number {
  return previous + 1
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const flag = (value: unknown): boolean => value === true

function buildProgram(): Command {
  const program = new Command()
  program
    .name('yaohe')
    .description([
      'generate engineering daily reports from AI coding sessions and Git evidence',
      '',
      'Collects evidence from Claude Code / Codex user prompts, Git commits, and working-tree',
      'changes, then generates an English daily report.',
      '',
      'Git commits count as completed evidence; uncommitted changes count as in-progress',
      'evidence; user prompts only express requests or intentions. The tool never reads or',
      'sends full Git diffs.',
    ].join('\n'))
    .version(readVersion(), '--version')
    .argument('[command]', "command to run (default: 'report')")
    .exitOverride()
    .showSuggestionAfterError()
    .addHelpText(
      'after',
      '\nOutput conventions:\n  The report or --dry-run prompt goes to stdout; progress, warnings, and logs go to stderr.',
    )

  program.addOption(
    new Option('--project <path>', 'Project directory or any subdirectory').default('.'),
  )
  program.option('--all-worktrees', 'Aggregate all worktrees of the repository; commits deduped by hash')
  program.option('--date <YYYY-MM-DD>', 'Natural day to summarize (default: today in the selected timezone)')
  program.addOption(
    new Option('--author <email>', 'Only commits with exactly this author email (default: git config user.email)')
      .conflicts('allAuthors'),
  )
  program.option('--all-authors', 'Collect commits from all authors')
  program.option('--no-uncommitted', 'Skip uncommitted working-tree changes')
  program.addOption(
    new Option('--agent <agent>', 'Local CLI used to generate the report (default auto: codex first)')
      .choices(['auto', 'codex', 'claude']),
  )
  program.option('--template <path>', 'Report template file; - reads from stdin')
  program.addOption(
    new Option('--template-lang <lang>', 'Default template language: en, zh, or auto (default: auto)')
      .choices(['en', 'zh', 'auto']),
  )
  program.option('--timeout <seconds>', 'Max seconds to wait for the agent (default 300, range 1..=86400)', parseTimeout)
  program.option('--output <path>', 'Atomically write the report to a file; otherwise write to stdout')
  program.option('--force', 'Allow overwriting existing --output / --dump-context files')
  program.option('--dry-run', 'Print only the final generation prompt without invoking an agent')
  program.option('--dump-context <path>', 'Write the structured context to JSON (may contain sensitive info)')
  program.option('--log-file <path>', 'Append logs to a file while still writing to stderr')
  program.option('-v, --verbose', 'Increase log verbosity (repeatable)', countVerbose, 0)
  return program
}

export function parseCliArgs(argv: string[]): CliValues {
  const program = buildProgram()
  program.parse(argv, { from: 'user' })

  const command = program.args[0] ?? 'report'
  if (command !== 'report') {
    throw new Error(`Unknown command \`${command}\`; only \`report\` is supported`)
  }

  const opts = program.opts() as Record<string, unknown>
  return {
    command,
    project: str(opts.project) ?? '.',
    allWorktrees: flag(opts.allWorktrees),
    date: str(opts.date),
    author: str(opts.author),
    allAuthors: flag(opts.allAuthors),
    noUncommitted: !flag(opts.uncommitted),
    agent: str(opts.agent) as AgentChoice | null,
    template: str(opts.template),
    templateLang: str(opts.templateLang) as TemplateLanguageChoice | null,
    timeout: typeof opts.timeout === 'number' ? opts.timeout : null,
    output: str(opts.output),
    force: flag(opts.force),
    dryRun: flag(opts.dryRun),
    dumpContext: str(opts.dumpContext),
    logFile: str(opts.logFile),
    verbosity: typeof opts.verbose === 'number' ? opts.verbose : 0,
  }
}
