import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { YaoheError } from './error.js'
import { decodeNonempty, ensureSuccess, runCommand } from './process.js'

function mockScript(dir: string, body: string): string {
  const path = join(dir, 'mock-agent')
  writeFileSync(path, `#!/bin/sh\nset -eu\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

test('passes args and prompt through stdin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaohe-proc-'))
  const executable = mockScript(
    dir,
    'input=$(cat); [ "$1" = expected ]; [ "$input" = hello ]; printf report; printf warning >&2',
  )
  const output = await runCommand(executable, ['expected'], { cwd: dir, timeoutSecs: 2 }, 'hello')
  expect(output.status).toBe(0)
  expect(output.stdout.toString()).toBe('report')
  expect(output.stderr.toString()).toBe('warning')
})

test('reports nonzero exit and empty output', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaohe-proc-'))
  const executable = mockScript(dir, 'cat >/dev/null; printf denied >&2; exit 7')
  const output = await runCommand(executable, [], { cwd: dir, timeoutSecs: 2 }, 'hello')
  expect(() => ensureSuccess('mock', output)).toThrow(/denied/)
  expect(() => decodeNonempty(Buffer.from('  \n'), 'mock output')).toThrow(/is empty/)
})

test('terminates on timeout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaohe-proc-'))
  const executable = mockScript(dir, 'cat >/dev/null; sleep 2')
  const error = await runCommand(executable, [], { cwd: dir, timeoutSecs: 1 }, 'hello')
    .catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(YaoheError)
  expect((error as YaoheError).code).toBe('TIMEOUT')
  expect((error as YaoheError).message).toMatch(/exceeded 1s/)
})

test('escalates SIGTERM to SIGKILL when the process ignores it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yaohe-proc-'))
  const executable = mockScript(dir, 'cat >/dev/null; trap "" TERM; while :; do sleep 1; done')
  const error = await runCommand(executable, [], { cwd: dir, timeoutSecs: 1 }, 'hello')
    .catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(YaoheError)
  expect((error as YaoheError).code).toBe('TIMEOUT')
  expect((error as YaoheError).message).toMatch(/exceeded 1s/)
})
