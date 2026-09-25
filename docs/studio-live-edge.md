# Studio visual refresh and current transcript position

## References
- Symbol Studio: https://www.symbolstudio.pl/en/
- Awwwards Lando Norris: https://www.awwwards.com/sites/lando-norris
- Awwwards Sonar Music: https://www.awwwards.com/sites/sonar-music

Use editorial hierarchy, an owned repeatable mark and thoughtful reveal/micro-
interaction patterns. Do not import competitors' logos, code, copy or assets.

## Changes
- Owned caption logo and matching vector/raster web favicon; custom identity is
  retained. The native installer icon/update release is not changed here.
- Ivory/charcoal/terracotta/citrus brand system. Warm speaker palette in live,
  chat and reading views. Separate dark accent text from white-label buttons.
- Editorial homepage, geometric signal poster, direct workflow links, actual
  illustrative product preview, FAQ, controlled entrances and reduced-motion.
- Shared LiveScrollArea used by recording, meetings/chat, Live Interview rail
  and standalone AI audio context. Immediate current-edge updates avoid the old
  post-growth near-bottom test and paced scrolling lag. History is accessible
  through explicit pause gestures and Jump to latest; archives stay stationary.
- Practice heading focus now runs on phase/question changes before paint, rather
  than being rerun when unrelated voice callbacks change and stealing field focus.

## Reproduce QA
```
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
node qa/refinement/fonts.mjs
node qa/refinement/server.mjs
# In another terminal:
python3 qa/refinement/verify.py
```
Pinned Playwright/Chromium is installed by `.github/workflows/transcript-refinement.yml`.
It builds actual Geist assets, checks 42 presentation and 28 live-scroll layouts,
contrast, transitions, pause and reduced motion. The separate coach workflow
checks the true LiveInterview + WorkspaceShell + RepositoryCoach combination and
latest speech on seven widths after hiding/reopening the rail.

For a restricted environment, use `node qa/refinement/bundle.mjs` and
`REFINEMENT_OFFLINE=.../qa-results/refinement-bundle CHROMIUM_PATH=/usr/bin/chromium
python3 qa/refinement/verify.py`. This checks the real components/controller but
fallback fonts, not the production font assets. Do not label it actual-font QA.

## Measurement boundaries
No saved recordings are edited. Test text is synthetic and no transcript/share
links, credentials, local model weights or audio samples are committed. These
changes fix rendering/scrolling behavior; they are not ASR accuracy or latency
benchmarks, authenticated E2E tests, or physical device permission tests. Live
Interview's compact rail still shows its existing bounded recent-turn window;
Export retains the session transcript. Saved pages remain static unless a
separate live-session subscription is active.
