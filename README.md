# LiveTranscript.ai

Real-time AI transcription for meetings, lectures, notes, and dictation — live at **[livetranscript.ai](https://livetranscript.ai)**.

Speak or capture a call and watch the words appear the moment they're said, with speaker labels, an AI correction pass, and shareable transcripts. Multi-party **meeting rooms** sync everyone's transcript live, and a **follow-along** mode helps you shadow-read a passage word-by-word.

---

## Features

- **Live transcription** — low-latency streaming captions from your microphone or system/tab audio.
- **Meeting rooms** — up to 5 speakers, each on their own device; transcripts sync in real time and every speaker gets a distinct color.
- **Follow-along** — repeat a passage aloud and a growing highlight trail tracks where you are, driven by your own voice (zero added latency — local alignment, no per-word model call).
- **Speaker identity** — names pulled from sign-in; rename/recolor any participant locally.
- **AI correction + summaries** — a fail-soft correction pass cleans finalized lines; sessions get a summary, key points, and action items.
- **Vocabulary packs** — per-context keyterm boosts (AWS, coding, systems, AI/ML, …) sent once at connection, so accuracy improves with no latency cost.
- **Share** — expiring public links to any saved transcript.
- **Mobile-responsive** across phone → desktop.

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router, React 19) |
| Styling | Tailwind CSS v4 |
| Auth | Clerk |
| Realtime (rooms) | Ably |
| Database | Neon Postgres + Drizzle ORM |
| Speech-to-text | Streaming ASR providers (capability-selected: fastest / highest-accuracy) |
| Correction & summaries | OpenAI |
| Analytics | PostHog |
| Hosting | Vercel |

> Note: Next.js 16 renames middleware to **`proxy.ts`** — that file (not `middleware.ts`) holds the Clerk route protection.

## Getting Started

```bash
npm install
cp .env.example .env.local   # then fill in your own keys (see below)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The app degrades gracefully: without Clerk keys it runs unauthenticated locally, and without a database it still transcribes (sessions just aren't saved).

## Environment Variables

Copy `.env.example` to `.env.local` and provide your own values. **Never commit real keys** — `.env.local` is gitignored.

| Variable | Purpose | Required |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk auth (public) | for auth |
| `CLERK_SECRET_KEY` | Clerk auth (server, secret) | for auth |
| `DEEPGRAM_API_KEY` | Streaming ASR | yes (transcription) |
| `ASSEMBLYAI_API_KEY` | Alternate ASR (higher accuracy) | optional |
| `OPENAI_API_KEY` | Correction + summaries | optional |
| `ABLY_API_KEY` | Realtime for meeting rooms | for rooms |
| `DATABASE_URL` | Neon Postgres connection | for saved sessions |
| `NEXT_PUBLIC_APP_URL` | Base URL for share links | recommended |
| `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` | Analytics (public) | optional |
| `POSTHOG_API_KEY` / `POSTHOG_HOST` | Server-side analytics | optional |
| `OWNER_USER_IDS` | Comma-separated Clerk user IDs granted unlimited access (env allowlist, never a DB flag) | optional |
| `BILLING_ENABLED` | `1` to turn on paid gating (off = everyone unlimited) | optional |
| `PREVIEW_NO_AUTH` | `1` to bypass auth locally for headless previews — hard-gated to non-production | dev only |

## Project Structure

```
app/            Next.js App Router routes
  (app)/        authenticated surfaces: record, room/[id], dashboard, session/[id], settings
  s/[token]/    public shared-transcript view
  api/          token minting, correction, summaries, realtime auth
components/      UI — transcript views, room panels, nav, site chrome
lib/
  transcription/  ASR provider abstraction + keyterm packs
  room/           realtime hooks, roster, shadow/follow alignment
  audio/          mic + system-audio capture, PCM
  db/             Drizzle schema
  billing/        entitlement (owner allowlist, plan gating)
  auth.ts         current-user resolution + preview bypass
proxy.ts        Clerk route protection (Next 16 middleware)
```

## Scripts

```bash
npm run dev          # start dev server
npm run build        # production build
npm run start        # serve the production build
npm run lint         # eslint
npm run test         # vitest (unit)
npm run test:watch   # vitest watch mode
```

## Audio Capture & Echo

For transcribing a **call** (Zoom, Meet, etc.), choose **System sound** rather than the microphone — it taps the audio digitally, so there's no speaker→mic echo and cleaner accuracy. Mic mode is for your own voice / the room you're in.

- **Windows:** System sound can capture full-system audio (share Entire Screen with "share system audio"), so the Zoom **desktop app** or a browser tab both work.
- **macOS:** browsers capture **tab** audio only, so run the call in a browser tab and capture that tab.

The picker in-app shows this guidance inline.

## Deployment

Deployed on Vercel. The project's framework must be set to `nextjs` (or App Router routes and `/api/*` 404). Environment variables are configured in the Vercel project settings (encrypted); secrets are marked sensitive.

## Security

- Secrets live only in environment variables (Vercel-encrypted in production, gitignored `.env.local` locally) — never in source or git history.
- Owner/unlimited access is an env allowlist (`OWNER_USER_IDS`), not a database flag, so no DB write or admin endpoint can escalate access.
- Meeting IDs are high-entropy and non-enumerable; realtime tokens are scoped server-side to a single room.
- The preview auth-bypass is hard-gated to non-production (`NODE_ENV` **and** `VERCEL_ENV`).
