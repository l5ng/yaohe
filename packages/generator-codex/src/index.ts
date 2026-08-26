import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Schema, type Context } from 'cordis'
import {
  checkCommand,
  decodeNonempty,
  ensureSuccess,
  runCommand,
  type GeneratorOptions,
  type ReportGenerator,
} from '@l5ng/yaohe-core'

export interface Config {
  command: string
}

export const Config = Schema.object({
  command: Schema.string().default('codex'),
})

export function codexArgs(outputPath: string): string[] {
  return [
    'exec',
    '-',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '--color',
    'never',
    '--skip-git-repo-check',
    '--output-last-message',
    outputPath,
  ]
}

export class CodexGenerator implements ReportGenerator {
  readonly id = 'codex'
  command: string

  constructor(command = 'codex') {
    this.command = command
  }

  checkAvailable(): Promise<void> {
    return checkCommand(this.command)
  }

  async generate(prompt: string, options: GeneratorOptions): Promise<string> {
    const cwd = mkdtempSync(join(tmpdir(), 'yaohe-codex-'))
    try {
      const outputPath = join(cwd, 'last-message.md')
      const output = await runCommand(
        this.command,
        codexArgs(outputPath),
        { cwd, timeoutSecs: options.timeoutSecs },
        prompt,
      )
      ensureSuccess('codex', output)
      let bytes: Buffer
      try {
        bytes = await readFile(outputPath)
      } catch {
        throw new Error('Codex did not produce the --output-last-message file; make sure your Codex CLI supports this flag')
      }
      return decodeNonempty(bytes, 'Codex final message')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }
}

export const name = 'generator-codex'

export const plugin = { name, Config, apply }

export function apply(ctx: Context, config: Config): void {
  const generator = new CodexGenerator(config.command)
  ctx.on('generator/select', async (choice, errors) => {
    if (choice !== 'auto' && choice !== 'codex') return null
    try {
      await generator.checkAvailable()
      return generator
    } catch (error) {
      errors.push((error as Error).message)
      return null
    }
  })
}
