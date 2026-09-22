"""HTTP regressions for the release checker; no external network or credentials."""
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import unittest


COMMIT = '1234567' + '0' * 33
SCRIPT = Path(__file__).with_name('verify_deployment.py')


class ReleaseCheckTests(unittest.TestCase):
    def run_check(self, mode):
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path == '/api/health':
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        'commit': '7654321' + '0' * 33 if mode == 'old-release' else COMMIT,
                        'features': ['repository-screenshots', 'repository-specialist-agents'],
                    }).encode())
                elif self.path == '/record':
                    if self.headers.get('Sec-Fetch-Dest') != 'document' or self.headers.get('Accept') != 'text/html':
                        self.send_response(404)
                    elif mode == 'unprotected':
                        self.send_response(200)
                    else:
                        self.send_response(307)
                        destination = 'https://example.invalid/sign-in' if mode == 'external-redirect' else '/sign-in?redirect_url=%2Frecord'
                        self.send_header('Location', destination)
                    self.end_headers()
                else:
                    self.send_response(200)
                    self.end_headers()

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        env = {**os.environ, 'NO_PROXY': '127.0.0.1', 'no_proxy': '127.0.0.1'}
        try:
            result = subprocess.run(
                [sys.executable, str(SCRIPT), f'http://127.0.0.1:{server.server_port}', COMMIT],
                text=True, capture_output=True, env=env, timeout=10,
            )
            return result.returncode, json.loads(result.stdout)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_browser_document_request_reaches_sign_in(self):
        code, report = self.run_check('healthy')
        self.assertEqual(code, 0, report)
        self.assertTrue(report['checks'][-1]['passed'])

    def test_wrong_release_fails(self):
        code, report = self.run_check('old-release')
        self.assertEqual(code, 1)
        self.assertEqual(report['checks'][-1]['name'], 'Exact release')

    def test_unprotected_recording_page_fails(self):
        code, _ = self.run_check('unprotected')
        self.assertEqual(code, 1)

    def test_unexpected_external_redirect_fails(self):
        code, _ = self.run_check('external-redirect')
        self.assertEqual(code, 1)


if __name__ == '__main__':
    unittest.main()
