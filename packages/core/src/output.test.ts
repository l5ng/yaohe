import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { writeOutput } from './output.js'

test('refuses overwrite without force and writes atomically with force', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaohe-output-'))
  const path = join(dir, 'report.md')

  writeOutput(path, 'one', false)
  expect(readFileSync(path, 'utf8')).toBe('one')
  expect(() => writeOutput(path, 'two', false)).toThrow(/use --force/)
  expect(readFileSync(path, 'utf8')).toBe('one')

  writeOutput(path, 'two', true)
  expect(readFileSync(path, 'utf8')).toBe('two')
  expect(existsSync(join(dir, 'report.md'))).toBe(true)
})

test('creates parent directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaohe-output-'))
  const path = join(dir, 'nested', 'deep', 'report.md')
  writeOutput(path, 'ok', false)
  expect(readFileSync(path, 'utf8')).toBe('ok')
})
