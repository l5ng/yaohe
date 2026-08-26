import { mkdtempSync, rmSync } from 'node:fs'
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
  command: Schema.string().default('claude'),
})

export function claudeArgs(): string[] {
  return ['-p', '--output-format', 'text', '--no-session-persistence', '--tools', '']
}

export class ClaudeGenerator implements ReportGenerator {
  readonly id = 'claude'
  command: string

  constructor(command = 'claude') {
    this.command = command
  }

  checkAvailable(): Promise<void> {
    return checkCommand(this.command)
  }

  async generate(prompt: string, options: GeneratorOptions): Promise<string> {
    const cwd = mkdtempSync(join(tmpdir(), 'yaohe-claude-'))
    try {
      const output = await runCommand(
        this.command,
        claudeArgs(),
        { cwd, timeoutSecs: options.timeoutSecs },
        prompt,
      )
      ensureSuccess('claude', output)
      return decodeNonempty(output.stdout, 'Claude output')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }
}

export const name = 'generator-claude'

export const plugin = { name, Config, apply }

export function apply(ctx: Context, config: Config): void {
  const generator = new ClaudeGenerator(config.command)
  ctx.on('generator/select', async (choice, errors) => {
    if (choice !== 'auto' && choice !== 'claude') return null
    try {
      await generator.checkAvailable()
      return generator
    } catch (error) {
      errors.push((error as Error).message)
      return null
    }
  })
}
