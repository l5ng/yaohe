#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { CommanderError } from 'commander'
import { run } from './app.js'
import { parseCliArgs } from './args.js'
import { buildEffectiveConfig, loadFileConfig } from './config.js'
import { NoActivityError } from './pipeline.js'

export async function main(argv: string[]): Promise<number> {
  try {
    const cli = parseCliArgs(argv)
    const file = loadFileConfig()
    const effective = buildEffectiveConfig(cli, file)
    await run(effective)
    return 0
  } catch (error) {
    if (error instanceof NoActivityError) {
      process.stderr.write('No collectable activity: no Git commits, working-tree changes, or valid AI user prompts found for the day.\n')
      return 2
    }
    if (error instanceof CommanderError) {
      // commander already printed the message (or help/version) before throwing
      return error.exitCode
    }
    process.stderr.write(`error: ${(error as Error).message}\n`)
    return 1
  }
}

// process.argv[1] is the path as invoked — npm/npx execute the .bin symlink,
// so it must be realpath'd before comparing with import.meta.url (which node
// already resolves to the real module path).
const isMain = process.argv[1]
  && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
if (isMain) {
  const code = await main(process.argv.slice(2))
  process.exitCode = code
}
