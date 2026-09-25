// One-time guarded registration on the reviewed feature branch only.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const file = 'src-tauri/src/lib.rs'
let content = readFileSync(file, 'utf8')
if (!content.includes('mod repo_capture;')) {
  const blob = createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex')
  if (blob !== 'c3e798fa3f2c1cdccbd87dda9a0dc2502721b4d4') throw new Error('Native shell changed; review registration manually')
  function replace(before, after, all = false) { const count = content.split(before).length - 1; if (count < 1 || (!all && count !== 1)) throw new Error(`Unexpected native anchor: ${before}, count=${count}`); content = content.split(before).join(after) }
  replace('mod remote_assist;', 'mod remote_assist;\nmod repo_capture;')
  replace('.manage(AudioState::default())', '.manage(AudioState::default())\n        .manage(repo_capture::RepoCaptureState::default())')
  replace('            remote_assist::remote_assist_stop\n', '            remote_assist::remote_assist_stop,\n            repo_capture::repo_capture_displays,\n            repo_capture::repo_capture_start,\n            repo_capture::repo_capture_frame,\n            repo_capture::repo_capture_stop\n')
  replace('                remote_assist::stop_for_exit(window.app_handle());', '                remote_assist::stop_for_exit(window.app_handle());\n                repo_capture::stop_for_exit(window.app_handle());', true)
  replace('                remote_assist::stop_for_exit(app);', '                remote_assist::stop_for_exit(app);\n                repo_capture::stop_for_exit(app);', true)
  replace('                            remote_assist::stop_all(\n', '                            repo_capture::stop_for_exit(app);\n                            remote_assist::stop_all(\n')
  writeFileSync(file, content)
}
const uiFile = 'components/repoLive/RepositoryWorkspace.tsx'
let ui = readFileSync(uiFile, 'utf8')
if (!ui.includes('import { NativeCaptureControls }')) {
  function replace(before, after) { if (ui.split(before).length !== 2) throw new Error('Unexpected UI anchor'); ui = ui.replace(before, after) }
  replace("import styles from './RepositoryWorkspace.module.css'", "import styles from './RepositoryWorkspace.module.css'\nimport { NativeCaptureControls } from './NativeCaptureControls'")
  replace('        {!isReplay && running && <div className={styles.capture}>\n', '        {!isReplay && running && <div className={styles.capture}>\n          <NativeCaptureControls available={observer.nativeAvailable} displays={observer.displays} busy={observer.phase === \'requesting\'} choose={observer.chooseNative} start={observer.beginNative} />\n          {observer.phase === \'watching\' && <button className={styles.button} disabled={observer.reading} onClick={observer.captureNow}>Capture now</button>}\n')
  writeFileSync(uiFile, ui)
}
console.log('Registered read-only native capture and explicit display selector')
