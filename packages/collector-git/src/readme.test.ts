import { expect, test } from 'vitest'
import { extractReadmeExcerpt } from './collector.js'

test('skips title, badges, and HTML before taking the first substantial paragraph', () => {
  const text = [
    '# yaohe',
    '',
    '![CI](https://example.com/ci.svg)',
    '[![npm](https://example.com/npm.svg)](https://www.npmjs.com/package/yaohe)',
    '<a href="https://example.com"><img src="logo.png" alt="logo"></a>',
    '',
    'This is the description of the project. It is longer than forty characters, so it qualifies.',
    '',
    '## Usage',
    '',
    'Run `yaohe` to generate a report.',
  ].join('\n')
  const [excerpt] = extractReadmeExcerpt(text, 12_000)
  expect(excerpt).toContain('This is the description of the project')
  expect(excerpt).not.toContain('# yaohe')
  expect(excerpt).not.toContain('![CI]')
  expect(excerpt).not.toContain('npm')
  expect(excerpt).not.toContain('Usage')
})

test('accepts a short Chinese description paragraph', () => {
  const text = ['# 工具', '', '这是一个研发日报生成工具。', '', '## 安装', '', 'pnpm install'].join('\n')
  const [excerpt] = extractReadmeExcerpt(text, 12_000)
  expect(excerpt).toBe('这是一个研发日报生成工具。')
})

test('truncates a long paragraph to the budget with an ellipsis', () => {
  const paragraph = 'This is a very long description that keeps going. '.repeat(30)
  const [excerpt, truncated] = extractReadmeExcerpt(`# Demo\n\n${paragraph}`, 80)
  expect(truncated).toBe(true)
  expect(Array.from(excerpt).length).toBe(81)
  expect(excerpt.endsWith('…')).toBe(true)
})

test('skips fenced code blocks while scanning paragraphs', () => {
  const text = [
    '# Demo',
    '',
    'The real description appears here and is long enough to be selected.',
    '',
    '```',
    'This is code and should never become the excerpt.',
    '```',
    '',
    'Another paragraph that would also qualify.',
  ].join('\n')
  const [excerpt] = extractReadmeExcerpt(text, 12_000)
  expect(excerpt).toContain('The real description')
  expect(excerpt).not.toContain('This is code')
})

test('falls back to cleaned text when no substantial paragraph exists', () => {
  const [excerpt] = extractReadmeExcerpt('# Demo\n\nshort line', 12_000)
  expect(excerpt).toBe('short line')
})

test('returns empty when the readme is nothing but noise', () => {
  const text = ['# Demo', '', '![badge](https://example.com/a.svg)', '<!-- comment -->'].join('\n')
  const [excerpt, truncated] = extractReadmeExcerpt(text, 12_000)
  expect(excerpt).toBe('')
  expect(truncated).toBe(false)
})
