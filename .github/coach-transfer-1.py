# Applies the reviewed local changes only to their exact source preimages.
# Temporary build transfer; not part of the application or final feature branch.
from pathlib import Path
import hashlib, os
ROOT = Path(os.environ['TARGET_ROOT']).resolve()
def put(name, old_hash, new_hash, operations):
    path = ROOT / name
    assert path.resolve().is_relative_to(ROOT), 'Invalid target path'
    old = path.read_bytes() if path.exists() else None
    assert (hashlib.sha256(old).hexdigest() if old is not None else None) == old_hash, 'Source mismatch: ' + name
    lines = (old.decode() if old is not None else '').splitlines(keepends=True)
    for start, end, content in reversed(operations):
        lines[start:end] = content.splitlines(keepends=True)
    data = ''.join(lines).encode()
    assert hashlib.sha256(data).hexdigest() == new_hash, 'Transfer mismatch: ' + name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print(name, new_hash)

put('.env.example', 'faa16f5a7102a77f4322ebc1c534b58e8b747138d5d4fbedb168697734a17e7d', 'fd26a72532b39e4365eb30ccc986bbea88375aa3faac97d9af7e808d32adabb4', [
    (73, 73, r"""
# --- Permission-based repository coach --- optional model role overrides
# Unset values inherit configured repository purpose models. No local weights bundled.
# COPILOT_COACH_TALK_MODEL=your_supported_model_id
# COPILOT_COACH_GUIDE_MODEL=your_supported_model_id
# COPILOT_COACH_REVIEW_MODEL=your_supported_model_id
"""),
])
put('.github/workflows/macos-coach-build.yml', None, 'db2cf52bd8d116c505419abfce27d0394e15aef5d35988f89d6b4049ef737db3', [
    (0, 0, r"""name: macOS repository coach build (unsigned)
on:
  pull_request:
    paths: ['src-tauri/**', 'lib/coach/**', 'components/coach/**', '.github/workflows/macos-coach-build.yml']
  workflow_dispatch:
permissions:
  contents: read
jobs:
  macos-universal:
    runs-on: macos-latest
    timeout-minutes: 35
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin,x86_64-apple-darwin
      - uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri -> target
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Build both audio helper architectures
        run: bash scripts/build-audio-helper.sh
      - name: Build universal test installer without publishing or updating users
        uses: tauri-apps/tauri-action@v0
        with:
          projectPath: .
          tauriScript: npx @tauri-apps/cli@2
          args: --target universal-apple-darwin --bundles dmg --config src-tauri/tauri.no-updater.conf.json
      - name: Record source and distribution limitations
        run: |
          mkdir -p qa-results/native
          printf 'Source: %s\nUnsigned, not notarized; no updater manifest is published. Physical screen/audio permissions are not tested by this build.\n' "$(git rev-parse HEAD)" > qa-results/native/BUILD.txt
      - uses: actions/upload-artifact@v4
        with:
          name: macos-universal-coach-unsigned
          path: |
            src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg
            qa-results/native/BUILD.txt
          if-no-files-found: error
          retention-days: 14
"""),
])
put('.gitignore', '4c76a4aae3b69fbca909ddab9cb86560c0b8d691fda94724bbb282fa83d38192', 'c3255b31822a37b323b3016f297d34dff70afb47e4bc7569090bd48a92217f3f', [
    (53, 53, r"""
# Local and CI verification artifacts (not application source)
/qa-results/
"""),
])
put('.vercelignore', '5c6dd062ae17c1bbdb1aa2139fcf0ba165fd06dcdc49ee793a2b1b32e62d463c', 'f45e0c84caa5e9b3b4c0027d7e8ccdd03f613f6fe7ebc84efee46065f39f6a8e', [
    (8, 8, r"""
# QA fixtures and render output are never deployed as web assets
qa
qa-results
"""),
])
put('app/(app)/interview/repository/page.tsx', 'c933a0fef6066e464bb891c63480a80258bf93df560b6ec1dc44aa7ff0f43038', '89cc409b55543b3f3a50323faacf3823e18961050f2bd22c0d3fce7e84bececb', [
    (8, 9, r"""  return <WorkspaceShell active="repository"><main className="mx-auto max-w-[1600px] p-3 sm:p-6"><header className="mb-5"><h1 className="text-2xl font-semibold">Repository coach</h1><p className="mt-2 text-sm text-ink/60">Practice an investigation or replay observed code. For hands-free interviewer audio, enable Repository coding interview in Live.</p><Link className="mt-3 inline-block text-sm underline" href="/interview">Live interview and Mock Lab</Link><span className="mx-3 text-ink/40">·</span><Link className="text-sm underline" href="/copilot?mode=repoInterview">Classic repository tools</Link></header><RepositoryCoach key={userId} /></main></WorkspaceShell>
"""),
])
put('components/coach/RepositoryCoach.tsx', 'c996663d7d45f80d61092949039641eaab34def17b4d0b8fed36a8b5c060a049', 'e91fee1ddcd28b333a772feefbc701ff2320a12b1385c6a59f01a53b90768ade', [
    (68, 69, r"""  useEffect(() => { mounted.current = true; return () => { mounted.current = false; activity.current?.(false) } }, [])
"""),
    (90, 91, r"""      const source = native ? await nativeFrameSource(displayId) : await browserFrameSource(() => { if (mounted.current && token === generation.current) void screen.stop() })
"""),
    (152, 152, r"""  const replay = controller.getReplayInfo()
"""),
    (162, 163, r"""        {running ? <button className={styles.button} onClick={pause}>Pause coach</button> : state.status === 'paused' && <button className={styles.button} disabled={loadedReplay && !state.question} onClick={() => loadedReplay ? controller.analyzeReplay() : controller.resume()}>{loadedReplay ? 'Analyze replay with AI' : 'Resume coach'}</button>}
"""),
    (167, 167, r"""      {loadedReplay && <section className={styles.main} aria-label="Replay timeline">
        <label className={styles.label} htmlFor="coach-replay-checkpoint">Observation {replay.position} of {replay.total} · {replay.event}</label>
        <input id="coach-replay-checkpoint" aria-label="Replay checkpoint" type="range" min={1} max={Math.max(1, replay.total)} value={replay.position} className={styles.input} onChange={event => { screen.watch(false); controller.seekReplay(Number(event.target.value)) }} />
        <div className={styles.feedback}><button className={styles.button} disabled={replay.position <= 1} onClick={() => controller.seekReplay(replay.position - 1)}>Previous observation</button><button className={styles.button} disabled={replay.position >= replay.total} onClick={() => controller.seekReplay(replay.position + 1)}>Next observation</button></div>
        <p className={styles.muted}>Seeking is offline. Future screenshots and saved model answers are excluded from this checkpoint’s context. Analyze replay with AI sends only the evidence visible so far.</p>
        {replay.references.length > 0 && <details className={styles.details}><summary>Previous responses and saved feedback · reference only</summary><ul className={styles.list}>{replay.references.map((item, index) => <li key={`${item.id}-${index}`}><strong>{item.lane} · {item.model || 'Model not recorded'} · {item.verdict || 'Not reviewed'}</strong><pre className={styles.code}>{item.text || item.summary}</pre>{item.note && <p>Review: {item.note}</p>}</li>)}</ul></details>}
      </section>}
"""),
])
put('components/interview/InterviewWorkspace.test.tsx', '52c4673128876a90b7dadda2974c191ec1099d3529e80fc0b0106f29a93f9a46', 'd7ec29e676ae5767c6a23efa765f504b29dc934872e8e692d54161f4b83e3ae4', [
    (22, 23, r"""    expect(navLink('Repository').getAttribute('href')).toBe('/interview/repository')
"""),
])
put('components/nav/WorkspaceShell.tsx', '252a049a393ea4fcb80aa9519059939f18caa5dc04e42f85ff96328408e51c6f', 'b9e3f4560570789294e307083fb078199174db28bb3209519c23eb0cd204e832', [
    (27, 28, r"""  { id: 'repository', href: '/interview/repository', label: 'Repository', icon: GitBranch },
"""),
])
put('docs/repository-coach.md', None, '776463035495801ed004c9ac5ebde98c04b2ac0d08deedacf40658bc7e2abf8f', [
    (0, 0, r"""# Evidence-driven repository coach

For practice and assessments/interviews explicitly permitting external AI. The app observes a selected source, suggests navigation and edits, and never submits an assessment, bypasses a platform restriction, writes repository files, or executes a suggested shell command.

## Entry points

- `/interview`: enable **Repository coding interview** before starting. Finalized interviewer audio feeds the same coach used in replay; candidate microphone text does not trigger investigations.
- `/interview/repository`: standalone coach, source/screenshot imports and replay controls.
- Mock Lab → **Repository replay**: load an exported event journal, move through observation checkpoints, inspect prior feedback, and explicitly re-analyze the selected checkpoint.
- `/copilot?mode=repoInterview`: classic screenshot/folder tooling remains available.

## Implemented pipeline

The browser or native selected display is sampled locally at 4 Hz. A stable-keyframe gate tolerates tiny caret blinking, detects persistent small edits, and emits at most one extraction request at a time. Captures have a 1.5 second minimum spacing, a 20/minute and 180/session ceiling, and an 18 second deadline. Stop and capture revocation invalidate outstanding work. Hashing/diffing is local; semantic interpretation still uses the configured screenshot provider. These are scheduling limits, not measured inference latencies.

The state reducer maintains bounded task, question, observation, partial file, navigation, proposed patch, observed edit, test-output and feedback records. Source IDs, capture timestamps and observed line ranges travel with source text. Overlapping screenshots merge only when anchors agree; edits retire old anchors conservatively. Late older screenshots cannot overwrite newer evidence. File imports are exact text but do not prove which editor view is open. Missing lines stay missing; confidence from extraction is a model-reported estimate, not a calibrated correctness probability.

Conversation and code guidance run concurrently. Talk streams independently; guide/review results are schema-validated before publication. The fast lane does not wait for a full repository analysis. Task/constraint changes refresh speech guidance and invalidate obsolete edits. A view confirmation must match a known requested path and observed range. Proposed edits require an exact current `before` region. Text matches to a proposal are not proof of correctness; different but potentially equivalent code is sent for review rather than automatically labeled wrong.

Context compilation uses bounded lexical/symbol-reference ranking plus observed paths, current view and test evidence. Cache keys depend on canonical observed content, not how overlapping screenshots were split. This is **not** a complete AST, type-resolved call graph, or proof of data flow. Budgets are measured in characters, not exact model tokens.

Test output is observation, not a command-execution attestation. **Mark test start** records a command label and code revision; the user then runs it in their own environment. Only fresh subsequent output may link to that marker. Later edits make results stale. Incomplete new-run output supersedes older terminal summaries, and one passing package cannot erase an earlier failure in the same run. Supported summary patterns include Jest/Vitest, pytest, TAP, Maven/Surefire, JUnit, unittest, dotnet, Rust and Go; unfamiliar output stays incomplete.

## Models and budgets

Server-only optional model overrides:

```
COPILOT_COACH_TALK_MODEL=<configured supported model>
COPILOT_COACH_GUIDE_MODEL=<configured supported model>
COPILOT_COACH_REVIEW_MODEL=<configured supported model>
```

Unset overrides inherit existing repository purpose models. Provider availability is validated; absent keys produce an explicit configuration error. Credentials never enter replay JSON. The controller permits at most 12 requests/minute and 120/session, without automatic failure retries. Server rate limiting is per-instance and is not a fleet-wide billing guarantee.

Laya/OpenJev/SemIf evaluation remains separate (PR #12). No checkpoint is installed or selected here. End-to-end latency, battery impact, extraction accuracy and coding quality must be measured with actual configured providers and physical devices before making performance claims.

## Replay and feedback

Replay exports contain selected source text and transcript fragments, not raw screenshots/audio. The export dialog requires acknowledgment because code can be private; known credential patterns are redacted but redaction is not a guarantee that all secrets are found.

Loading is offline and paused. **Previous/Next observation** and the checkpoint slider rebuild only the evidence available at that point; future observations cannot leak into the context. Old model responses and user notes are reference-only. **Analyze replay** makes explicitly requested provider calls using that checkpoint. Feedback never automatically promotes a model, trains weights, or modifies production prompts.

## Reproducible validation

```
node --test scripts/test-repo-coach.mjs
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm run lint
pnpm run build
node qa/coach/server.mjs
python3 qa/coach/verify.py
python3 scripts/golden-repo-smoke.py --output qa-results/golden
```

The browser suite renders both the standalone coach and the real WorkspaceShell + LiveInterview + RepositoryCoach at 375, 768, 1024, 1280, 1440, 1920 and 2560 CSS pixels. It checks readable width, page overflow, no active chat composer, grounding, pause/end and repeated-question behavior. Audio, extraction and model boundaries are synthetic fixtures, not live provider or OS-permission tests.

For an offline browser renderer without network navigation, `node qa/coach/bundle.mjs` builds self-contained QA bundles. Set `COACH_OFFLINE_BUNDLES=qa-results/coach-bundles` when running `verify.py`; the report labels this mode explicitly. No production authentication is modified by the QA fixtures.

Golden fixtures are **24 authored micro-repositories**, four defect families across JavaScript, Python, Java, Go, C# and Rust. Their intentionally faulty baselines must fail and authored replacements must pass. They are not 24 framework-scale projects and do not measure model patch pass@1. Provider-backed eval steps that skip for missing keys are not quality passes.

## Desktop distribution

Native read-only capture uses explicit selected-display leases on Windows and macOS. New native commands require a newly built installer; a web deployment does not add commands to an old binary. CI runs native lease tests and platform compilation. Unsigned Windows and universal macOS test installers are separate from the signed/notarized release and updater process. Packaging success is not physical audio/screen permission validation.

## Remaining measured-release gates

- Real-provider end-to-end trials, held-out accuracy and cost/latency measurements.
- Representative multi-file framework tasks beyond authored micro-fixtures.
- Physical macOS/Windows permission, capture, heat/battery and installer checks.
- Licensed/calibrated local model selection, optional semantic ASR reconstruction and deeper static-analysis integration.
- Signed/notarized public installer publication where signing credentials are available.
"""),
])
