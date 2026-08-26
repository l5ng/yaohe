import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@l5ng/yaohe-core': src('packages/core/src/index.ts'),
      '@l5ng/yaohe-collector-git': src('packages/collector-git/src/index.ts'),
      '@l5ng/yaohe-collector-sessions': src('packages/collector-sessions/src/index.ts'),
      '@l5ng/yaohe-generator-codex': src('packages/generator-codex/src/index.ts'),
      '@l5ng/yaohe-generator-claude': src('packages/generator-claude/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
  },
})
