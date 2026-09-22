import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// Sequential trials may include many provider timeouts. Every trial checkpoints;
// an interrupted or incomplete run is never eligible for a policy.
export default defineConfig({ plugins: [tsconfigPaths()], test: { environment: 'node', include: ['evals/repo/runBenchmark.ts', 'evals/repo/manageBenchmark.ts'], testTimeout: 7_200_000 } })
