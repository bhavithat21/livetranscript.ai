import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({ plugins: [tsconfigPaths()], test: { environment: 'node', include: ['evals/repo/runBenchmark.ts'], testTimeout: 600_000 } })
