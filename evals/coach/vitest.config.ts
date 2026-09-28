import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
export default defineConfig({ plugins: [tsconfigPaths()], test: { environment: 'node', include: ['evals/coach/runBenchmark.ts'], testTimeout: 900_000 } })
