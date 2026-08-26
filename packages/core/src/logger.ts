import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Context, Service } from 'cordis'

export type LogLevel = 'warn' | 'info' | 'debug'

export interface LoggerConfig {
  level: LogLevel
  file?: string
}

const LEVEL_ORDER: Record<LogLevel, number> = { warn: 0, info: 1, debug: 2 }

export class LoggerService extends Service {
  config: LoggerConfig

  constructor(ctx: Context, config: LoggerConfig) {
    super(ctx, 'yaoheLog', true)
    this.config = config
    if (config.file) {
      mkdirSync(dirname(config.file) || '.', { recursive: true })
    }
  }

  log(level: LogLevel, message: string): void {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[this.config.level]) return
    const line = `[${level}] ${message}\n`
    process.stderr.write(line)
    if (this.config.file) {
      try {
        appendFileSync(this.config.file, line)
      } catch {
        // A log-file write failure must not block the main flow
      }
    }
  }

  warn(message: string): void {
    this.log('warn', message)
  }

  info(message: string): void {
    this.log('info', message)
  }

  debug(message: string): void {
    this.log('debug', message)
  }
}

declare module 'cordis' {
  interface Context {
    yaoheLog: LoggerService
  }
}
