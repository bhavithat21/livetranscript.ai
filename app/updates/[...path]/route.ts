import { NextRequest, NextResponse } from 'next/server'

// Desktop auto-update channel. The updater endpoint baked into shipped binaries
// (tauri.conf.json → https://livetranscript.ai/updates/latest.json) is PERMANENT —
// already-installed apps can never be told a new URL — so it must be a stable path
// WE control, not a raw Blob URL (which can rotate) or GitHub releases (which a
// private repo blocks anonymously). This route is that stable front door: it
// redirects every /updates/<file> to the current public store base
// (UPDATES_BASE_URL, e.g. a Vercel Blob public base), so we can move/rotate the
// backing store without ever changing what shipped apps hit.
//
// Tauri's updater (reqwest) follows redirects for BOTH the manifest fetch and the
// installer download, so a 307 works for latest.json and the binaries alike.
//
// This path is public (see proxy.ts) — the updater is unauthenticated.

// A stale manifest would offer old versions; a short cache is fine and cheap.
export const revalidate = 60

function isSafeSegment(p: string): boolean {
  // Only forward simple filenames/segments — no traversal, no absolute/scheme.
  return /^[A-Za-z0-9._/-]+$/.test(p) && !p.includes('..')
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const base = process.env.UPDATES_BASE_URL
  if (!base) {
    // Not configured yet → tell the updater there's nothing (it treats a non-2xx
    // /200-with-no-update as "up to date" and fails soft). 503 is honest.
    return NextResponse.json({ error: 'Updates not configured' }, { status: 503 })
  }

  const { path } = await params
  const rel = (path ?? []).join('/')
  if (!rel || !isSafeSegment(rel)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Redirect to the current public store. base has no trailing slash by convention.
  const target = `${base.replace(/\/$/, '')}/${rel}`
  return NextResponse.redirect(target, 307)
}
