import { spawn } from 'node:child_process'
import { YaoheError } from './error.js'

// ponytail: fixed 1s SIGTERM grace before SIGKILL; add a knob if an agent ever needs a longer shutdown
const KILL_GRACE_MS = 1000

export interface ProcessOutput {
  status: number | null
  stdout: Buffer
  stderr: Buffer
}

export interface RunOptions {
  cwd: string
  timeoutSecs: number
}

export function runCommand(
  program: string,
  args: string[],
  options: RunOptions,
  prompt: string,
): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    const isPosix = process.platform !== 'win32'
    const child = spawn(program, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // detached lets us signal the whole process tree on POSIX
      detached: isPosix,
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let timedOut = false
    let settled = false
    let timer: NodeJS.Timeout

    const killTree = (signal: NodeJS.Signals): void => {
      if (isPosix && child.pid) {
        try {
          process.kill(-child.pid, signal)
          return
        } catch {
          // process group already gone; fall through to child.kill()
        }
      }
      child.kill(signal)
    }

    const escalate = (): void => {
      timedOut = true
      killTree('SIGTERM')
      timer = setTimeout(() => killTree('SIGKILL'), KILL_GRACE_MS)
    }
    timer = setTimeout(escalate, options.timeoutSecs * 1000)

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    child.stdin.on('error', () => {})

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new YaoheError(`Failed to start ${program}: ${error.message}`, 'GENERATOR_FAILED', {
        cause: error,
      }))
    })

    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const output: ProcessOutput = {
        status: code,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      }
      if (timedOut) {
        reject(new YaoheError(
          `Generator exceeded ${options.timeoutSecs}s and was terminated (${signal ?? 'SIGTERM'}): ${stderrSummary(output.stderr)}`,
          'TIMEOUT',
        ))
      } else {
        resolve(output)
      }
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })
}

export async function checkCommand(program: string): Promise<void> {
  const output = await new Promise<ProcessOutput>((resolve, reject) => {
    const child = spawn(program, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({
        status: code,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      })
    })
  })
  if (output.status !== 0) {
    throw new YaoheError(
      `\`${program} --version\` failed (${output.status}): ${stderrSummary(output.stderr)}`,
      'GENERATOR_FAILED',
    )
  }
}

export function ensureSuccess(program: string, output: ProcessOutput): void {
  if (output.status === 0) return
  throw new YaoheError(
    `${program} failed (${output.status}). Make sure the CLI is installed and signed in: ${stderrSummary(output.stderr)}`,
    'GENERATOR_FAILED',
  )
}

export function decodeNonempty(bytes: Buffer, label: string): string {
  const text = bytes.toString('utf8')
  if (text.trim() === '') {
    throw new YaoheError(`${label} is empty`, 'GENERATOR_FAILED')
  }
  return text
}

export function stderrSummary(bytes: Buffer): string {
  const text = bytes.toString('utf8').trim()
  if (text === '') return 'no stderr output'
  const chars = Array.from(text)
  if (chars.length <= 4_000) return text
  return chars.slice(0, 4_000).join('') + '…'
}
