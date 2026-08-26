import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  detectTemplateLanguage,
  detectUserLanguage,
  loadTemplate,
  renderTemplate,
} from './template.js'

test('renders only supported placeholders', () => {
  const rendered = renderTemplate('# {{date}} {{project}} {{other}}', '2026-07-22', 'demo')
  expect(rendered).toBe('# 2026-07-22 demo {{other}}')
})

test('loads template from file and rejects empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaohe-template-'))
  const path = join(dir, 'template.md')
  writeFileSync(path, '# {{date}} {{project}}\n')
  expect(await loadTemplate(path, '2026-07-22', 'demo')).toBe('# 2026-07-22 demo\n')

  writeFileSync(path, '   \n')
  await expect(loadTemplate(path, 'd', 'p')).rejects.toThrow(/template cannot be empty/)

  const missing = join(dir, 'missing.md')
  await expect(loadTemplate(missing, 'd', 'p')).rejects.toThrow(/Failed to read template file/)
})

test('default template keeps the documented shape', async () => {
  const rendered = await loadTemplate(undefined, '2026-07-22', 'demo')
  expect(rendered).toMatch(/# 2026-07-22 Daily Report/)
  expect(rendered).toMatch(/### Completed/)
  expect(rendered).toMatch(/### Blockers/)
  expect(rendered).toMatch(/### Effort/)
})

test('chinese default template keeps the documented shape', async () => {
  const rendered = await loadTemplate(undefined, '2026-07-22', 'demo', 'zh')
  expect(rendered).toMatch(/# 2026-07-22 日报/)
  expect(rendered).toMatch(/### 完成事项/)
  expect(rendered).toMatch(/### 问题 \/ 阻塞/)
  expect(rendered).toMatch(/### 工时 \/ 精力/)
})

test('detects template language from content', () => {
  expect(detectTemplateLanguage('# hello world')).toBe('en')
  expect(detectTemplateLanguage('# 你好世界')).toBe('zh')
})

test('detects user language from locale environment variables', () => {
  const saved: Record<string, string | undefined> = {
    LC_ALL: process.env.LC_ALL,
    LC_MESSAGES: process.env.LC_MESSAGES,
    LANG: process.env.LANG,
  }
  try {
    delete process.env.LC_ALL
    delete process.env.LC_MESSAGES
    process.env.LANG = 'zh_CN.UTF-8'
    expect(detectUserLanguage()).toBe('zh')

    process.env.LANG = 'en_US.UTF-8'
    expect(detectUserLanguage()).toBe('en')

    delete process.env.LANG
    process.env.LC_MESSAGES = 'zh-Hans-CN'
    expect(detectUserLanguage()).toBe('zh')

    process.env.LC_MESSAGES = 'ja_JP.UTF-8'
    expect(detectUserLanguage()).toBe('en')

    delete process.env.LC_MESSAGES
    process.env.LC_ALL = 'C.UTF-8'
    expect(detectUserLanguage()).toBe('en')

    // empty values count as unset, so LC_ALL="" falls through to LANG
    process.env.LC_ALL = ''
    process.env.LANG = 'zh_CN.UTF-8'
    expect(detectUserLanguage()).toBe('zh')
  } finally {
    process.env.LC_ALL = saved.LC_ALL
    process.env.LC_MESSAGES = saved.LC_MESSAGES
    process.env.LANG = saved.LANG
  }
})
