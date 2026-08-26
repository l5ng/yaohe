import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { main } from './cli.js'

interface CliResult {
  code: number
  stdout: string
  stderr: string
}

async function runCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  const stdout: string[] = []
  const stderr: string[] = []
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk))
    return true
  })
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk))
    return true
  })
  const saved = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(env)) {
    saved.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  try {
    const code = await main(args)
    return { code, stdout: stdout.join(''), stderr: stderr.join('') }
  } finally {
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

function git(root: string, args: string[], extraEnv: Record<string, string> = {}): void {
  execFileSync('git', ['-C', root, ...args], {
    stdio: 'ignore',
    env: { ...process.env, ...extraEnv },
  })
}

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'yaohe-cli-repo-'))
  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.name', 'Alice'])
  git(root, ['config', 'user.email', 'alice@example.com'])
  writeFileSync(join(root, 'README.md'), '# demo repo\n')
  writeFileSync(join(root, 'work.txt'), 'one\n')
  git(root, ['add', 'README.md', 'work.txt'])
  git(root, ['commit', '-q', '-m', 'initial'], {
    GIT_AUTHOR_DATE: '2026-08-26T02:00:00Z',
    GIT_COMMITTER_DATE: '2026-08-26T02:00:00Z',
  })
  return root
}

test('dry run collects repo and claude session evidence', async () => {
  const repo = makeRepo()
  const sessions = join(repo, '.sessions-fixture')
  mkdirSync(join(sessions, 'projects'), { recursive: true })
  writeFileSync(
    join(sessions, 'projects', 's1.jsonl'),
    `${JSON.stringify({
      type: 'user',
      sessionId: 's1',
      cwd: repo,
      timestamp: '2026-08-26T02:30:00Z',
      message: { role: 'user', content: 'build the daily report CLI' },
    })}\n`,
  )

  const result = await runCli(
    ['--dry-run', '--project', repo, '--date', '2026-08-26'],
    { CLAUDE_CONFIG_DIR: sessions, CODEX_HOME: join(repo, '.empty-codex') },
  )
  expect(result.code).toBe(0)
  expect(result.stdout).toMatch(/# 2026-08-26 Daily Report/)
  expect(result.stdout).toMatch(/Structured context/)
  expect(result.stdout).toMatch(/"schema_version": 2/)
  expect(result.stdout).toMatch(/build the daily report CLI/)
  expect(result.stdout).toMatch(/"commits"/)
})

test('chinese default template generates a chinese prompt', async () => {
  const repo = makeRepo()
  const configDir = mkdtempSync(join(tmpdir(), 'yaohe-cli-zh-'))
  const configPath = join(configDir, 'config.toml')
  writeFileSync(configPath, 'template_lang = "zh"\n')
  const result = await runCli(
    ['--dry-run', '--project', repo, '--date', '2026-08-26'],
    {
      YAOHE_CONFIG: configPath,
      CLAUDE_CONFIG_DIR: join(repo, '.no-sessions'),
      CODEX_HOME: join(repo, '.no-codex'),
    },
  )
  expect(result.code).toBe(0)
  expect(result.stdout).toMatch(/# 2026-08-26 日报/)
  expect(result.stdout).toMatch(/严谨的中文研发日报编辑器/)
})

test('--template-lang flag switches the default template language', async () => {
  const repo = makeRepo()
  const result = await runCli(
    ['--dry-run', '--project', repo, '--date', '2026-08-26', '--template-lang', 'zh'],
    { CLAUDE_CONFIG_DIR: join(repo, '.no-sessions'), CODEX_HOME: join(repo, '.no-codex') },
  )
  expect(result.code).toBe(0)
  expect(result.stdout).toMatch(/# 2026-08-26 日报/)
  expect(result.stdout).toMatch(/严谨的中文研发日报编辑器/)
})

test('exits 2 when there is no activity', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'yaohe-cli-empty-'))
  git(repo, ['init', '-q', '-b', 'main'])
  git(repo, ['config', 'user.email', 'alice@example.com'])
  const result = await runCli(
    ['--project', repo, '--date', '2026-08-26'],
    { CLAUDE_CONFIG_DIR: join(repo, '.no-sessions'), CODEX_HOME: join(repo, '.no-codex') },
  )
  expect(result.code).toBe(2)
  expect(result.stderr).toMatch(/No collectable activity/)
})

test('help and version exit 0', async () => {
  const help = await runCli(['--help'])
  expect(help.code).toBe(0)
  expect(help.stdout).toMatch(/--all-worktrees/)
  const version = await runCli(['--version'])
  expect(version.code).toBe(0)
  expect(version.stdout).toMatch(/yaohe 0\.1\.0/)
})
