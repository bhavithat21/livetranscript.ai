#!/usr/bin/env python3
"""Read-only release smoke checks. Does not claim live AI functionality."""
import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('origin', help='Existing deployment origin, e.g. https://livetranscript.ai')
    parser.add_argument('commit', help='Expected Git commit SHA (7–40 hexadecimal characters)')
    args = parser.parse_args()
    origin = urllib.parse.urlsplit(args.origin)
    if origin.scheme not in ('https', 'http') or not origin.hostname or origin.username or origin.password or origin.path not in ('', '/') or origin.query or origin.fragment:
        parser.error('Provide an origin without credentials, paths, queries or fragments')
    if origin.scheme != 'https' and origin.hostname not in ('localhost', '127.0.0.1', '::1'):
        parser.error('Use HTTPS for deployed apps')
    if not re.fullmatch(r'[a-fA-F0-9]{7,40}', args.commit):
        parser.error('Expected commit must contain 7–40 hexadecimal characters')
    base = args.origin.rstrip('/')
    opener = urllib.request.build_opener(NoRedirect)
    report = {'origin': base, 'expectedCommit': args.commit, 'checks': [], 'liveAiTest': 'not run; requires sign-in and model credentials'}

    def fetch(path):
        req = urllib.request.Request(base + path, headers={'User-Agent': 'LiveTranscript-Release-Check', 'Cache-Control': 'no-cache'})
        try:
            with opener.open(req, timeout=20) as response:
                return response.status, response.headers, response.read(300_000)
        except urllib.error.HTTPError as error:
            return error.code, error.headers, error.read(1000)

    def check(name, passed, detail):
        report['checks'].append({'name': name, 'passed': bool(passed), 'detail': detail})
        if not passed:
            print(json.dumps(report, indent=2))
            return False
        return True

    try:
        status, headers, body = fetch('/api/health')
        if not check('Release endpoint', status == 200 and 'application/json' in headers.get('Content-Type', ''), f'HTTP {status}'):
            return 1
        health = json.loads(body)
        actual = health.get('commit') or ''
        if not check('Exact release', isinstance(actual, str) and actual.lower().startswith(args.commit.lower()), actual or 'No release SHA returned'):
            return 1
        expected = {'repository-screenshots', 'repository-specialist-agents'}
        if not check('Repository feature identifiers', expected.issubset(set(health.get('features', []))), health.get('features', [])):
            return 1
        status, _, _ = fetch('/')
        if not check('Home page', status == 200, f'HTTP {status}'):
            return 1
        status, headers, _ = fetch('/record')
        redirect = urllib.parse.urljoin(base, headers.get('Location', ''))
        target = urllib.parse.urlsplit(redirect)
        protected = status in (302, 303, 307, 308) and target.netloc == origin.netloc and target.path.startswith('/sign-in')
        if not check('Signed-out recording page requires sign-in', protected, f'HTTP {status}; redirect path {target.path}'):
            return 1
        print(json.dumps(report, indent=2))
        return 0
    except (OSError, ValueError, TypeError, AttributeError) as error:
        report['checks'].append({'name': 'Network/response', 'passed': False, 'detail': str(error)})
        print(json.dumps(report, indent=2))
        return 1


if __name__ == '__main__':
    sys.exit(main())
