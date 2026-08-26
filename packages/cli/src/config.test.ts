import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { buildEffectiveConfig, loadFileConfig } from './config.js'
import { parseCliArgs } from './args.js'
import { detectUserLanguage } from '@l5ng/yaohe-core'

test('cli values override file config including explicit auto', () => {
  const cli = parseCliArgs(['--agent', 'auto', '--timeout', '42'])
  const effective = buildEffectiveConfig(cli, {
    agent: 'claude',
    timeout: 99,
  })
  expect(effective.agent).toBe('auto')
  expect(effective.timeoutSecs).toBe(42)
})

test('file config applies when cli is unspecified', () => {
  const cli = parseCliArgs([])
  const effective = buildEffectiveConfig(cli, {
    agent: 'codex',
    timeout: 77,
    include_uncommitted: false,
  })
  expect(effective.agent).toBe('codex')
  expect(effective.timeoutSecs).toBe(77)
  expect(effective.includeUncommitted).toBe(false)
})

test('all worktrees and defaults are respected', () => {
  const cli = parseCliArgs(['--all-worktrees', '--no-uncommitted'])
  const effective = buildEffectiveConfig(cli, {})
  expect(effective.allWorktrees).toBe(true)
  expect(effective.includeUncommitted).toBe(false)
  expect(effective.timeoutSecs).toBe(300)
  expect(effective.budgets.total_chars).toBe(120_000)
})

test('rejects config values below budget and timeout minimums', () => {
  const cli = parseCliArgs([])
  expect(() => buildEffectiveConfig(cli, { context_budget_chars: 100 })).toThrow(/Invalid config/)
  expect(() => buildEffectiveConfig(cli, { max_prompts: 0 })).toThrow(/Invalid config/)
  expect(() => buildEffectiveConfig(cli, { timeout: 0 })).toThrow(/Invalid config/)
})

test('accepts exact budget minimums', () => {
  const cli = parseCliArgs([])
  const effective = buildEffectiveConfig(cli, {
    context_budget_chars: 4096,
    prompt_budget_chars: 1024,
    readme_budget_chars: 256,
    max_prompts: 1,
  })
  expect(effective.budgets.total_chars).toBe(4096)
  expect(effective.budgets.prompt_chars).toBe(1024)
  expect(effective.budgets.readme_chars).toBe(256)
  expect(effective.budgets.max_prompts).toBe(1)
})

test('template_lang defaults to auto-detection and accepts explicit values', () => {
  const cli = parseCliArgs([])
  expect(buildEffectiveConfig(cli, {}).templateLang).toBe(detectUserLanguage())
  expect(buildEffectiveConfig(cli, { template_lang: 'auto' }).templateLang).toBe(detectUserLanguage())
  expect(buildEffectiveConfig(cli, { template_lang: 'zh' }).templateLang).toBe('zh')
  expect(buildEffectiveConfig(cli, { template_lang: 'en' }).templateLang).toBe('en')
  expect(() => buildEffectiveConfig(cli, { template_lang: 'fr' })).toThrow(/Invalid config/)
})

test('cli --template-lang overrides the config file', () => {
  const cliZh = parseCliArgs(['--template-lang', 'zh'])
  expect(buildEffectiveConfig(cliZh, { template_lang: 'en' }).templateLang).toBe('zh')
  const cliEn = parseCliArgs(['--template-lang', 'en'])
  expect(buildEffectiveConfig(cliEn, { template_lang: 'zh' }).templateLang).toBe('en')
})

test('invalid agent in config is rejected with CONFIG_INVALID', () => {
  const cli = parseCliArgs([])
  try {
    buildEffectiveConfig(cli, { agent: 'gpt' })
    expect.unreachable('expected a validation error')
  } catch (error) {
    const err = error as { code?: string; message?: string }
    expect(err.code).toBe('CONFIG_INVALID')
    expect(err.message).toMatch(/Invalid config/)
  }
})

test('loads toml config file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaohe-config-'))
  const path = join(dir, 'config.toml')
  writeFileSync(path, [
    'agent = "codex"',
    'timezone = "Asia/Shanghai"',
    'include_uncommitted = false',
    'timeout = 42',
    'max_prompts = 10',
  ].join('\n'))
  try {
    process.env.YAOHE_CONFIG = path
    const config = loadFileConfig()
    expect(config.agent).toBe('codex')
    expect(config.timezone).toBe('Asia/Shanghai')
    expect(config.include_uncommitted).toBe(false)
    expect(config.timeout).toBe(42)
    expect(config.max_prompts).toBe(10)
  } finally {
    delete process.env.YAOHE_CONFIG
  }
})
