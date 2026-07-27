// Pure vector math, shared by client (retrieval/rerank) and server (embed route).
// Lives on its own — NOT in the 'use client' useModeContext — so server code and
// the rerank module can import it without pulling in a client component or creating
// an import cycle.

// Cosine similarity of two equal-length embedding vectors. Returns 0 if either has
// zero magnitude (degenerate), so callers never divide by zero.
export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}
