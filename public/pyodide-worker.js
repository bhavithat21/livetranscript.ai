// Pyodide sandbox worker. Runs Python OFF the main thread so (a) a CPU-bound
// loop (`while True: pass`) can't freeze the tab and a real wall-clock timeout
// works by terminating the worker, and (b) executed Python has no DOM: a worker
// global scope exposes no document/cookies/localStorage, so `import js` can't
// read the page session. Pinned to one Pyodide version.
const PYODIDE_VERSION = '0.26.4'
const CDN = 'https://cdn.jsdelivr.net/pyodide/v' + PYODIDE_VERSION + '/full/'

let pyodide = null
let out = ''

async function load() {
  importScripts(CDN + 'pyodide.js')
  pyodide = await self.loadPyodide({ indexURL: CDN })
  pyodide.setStdout({ batched: function (s) { out += s } })
  pyodide.setStderr({ batched: function (s) { out += s } })
}

self.onmessage = async function (e) {
  const msg = e.data
  if (msg.type === 'load') {
    try {
      await load()
      self.postMessage({ type: 'loaded' })
    } catch (err) {
      self.postMessage({ type: 'loadError', error: String((err && err.message) || err) })
    }
    return
  }
  if (msg.type === 'run') {
    out = ''
    try {
      const raw = await pyodide.runPythonAsync(msg.code)
      let rawStr = null
      try { rawStr = raw === undefined || raw === null ? null : String(raw) } catch (_) { rawStr = null }
      self.postMessage({ type: 'result', id: msg.id, ok: true, output: out, raw: rawStr })
    } catch (err) {
      self.postMessage({ type: 'result', id: msg.id, ok: false, output: out, raw: null, error: String((err && err.message) || err) })
    }
  }
}
