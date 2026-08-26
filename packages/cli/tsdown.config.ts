import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: 'esm',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  outExtension: () => ({ js: '.js', dts: '.d.ts' }),
  deps: {
    alwaysBundle: [/@l5ng\//],
  },
})
