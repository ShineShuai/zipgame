#!/usr/bin/env python3
"""End-to-end check of the sync phrase in a real browser (not in `npm test`: no browser there).

Two browser contexts (two "devices") share a mocked Supabase endpoint (the functions of
server/supabase/sync.sql, answered by this script). Device A has a 5-day streak and makes a sync
phrase; device B types the phrase and must show the streak. A wrong phrase must be refused and
leave the device off. Needs Python Playwright with Chromium
(`pip install playwright && playwright install chromium`).

    (cd webapp && python3 -m http.server 8123 &)   # serve the app
    python3 webapp/test/e2e/sync-cloud.e2e.py

The app's CSP forbids eval, so the waits use locators, not strings of script.
"""
import json, re, time
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:8123/index.html'
groups = {}   # id -> { verifier, slices: {dev: {seq, data}} }
calls = []

def rpc(name, a):
    if name == 'sync_put':
        g = groups.setdefault(a['p_id'], {'verifier': a['p_auth'], 'slices': {}})
        if g['verifier'] != a['p_auth']:
            return 403, {'code': '42501', 'message': 'unauthorized'}
        cur = g['slices'].get(a['p_dev'])
        stored = not cur or cur['seq'] < a['p_seq']
        if stored: g['slices'][a['p_dev']] = {'seq': a['p_seq'], 'data': a['p_data']}
        return 200, {'ok': True, 'stored': stored}
    if name == 'sync_get':
        g = groups.get(a['p_id'])
        have = a.get('p_have') or {}
        slices = (g or {'slices': {}})['slices']
        out = [{'dev': d, 'seq': s['seq'], 'data': s['data']} for d, s in sorted(slices.items())
               if s['seq'] > int(have.get(d, 0) or 0)]
        return 200, {'slices': out}
    if name == 'sync_delete':
        g = groups.get(a['p_id'])
        if not g: return 200, {'deleted': False}
        if g['verifier'] != a['p_auth']: return 403, {'message': 'unauthorized'}
        del groups[a['p_id']]; return 200, {'deleted': True}
    return 404, {}

CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
        'access-control-allow-methods': 'POST, OPTIONS'}
def handler(route):
    req = route.request
    if req.method == 'OPTIONS':
        return route.fulfill(status=204, headers=CORS)
    name = req.url.split('/rest/v1/rpc/')[1].split('?')[0]
    status, body = rpc(name, json.loads(req.post_data or '{}'))
    calls.append((name, status))
    route.fulfill(status=status, headers={**CORS, 'content-type': 'application/json'},
                  body=json.dumps(body))

today = int(time.time() // 86400)
STREAK = json.dumps({'last': today, 'streak': 5, 'best': 5, 'freezes': 0, 'earned': 1,
                     'prog': 1, 'brk': None})

def streak_text(page):
    m = re.search(r'(\d+)\s*day streak', page.inner_text('body'))
    return m.group(1) if m else None

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---- device A: has a 5-day streak, makes a sync phrase
    ca = b.new_context(viewport={'width': 390, 'height': 900})
    ca.route('**/rest/v1/rpc/sync_*', handler)
    a = ca.new_page()
    a.add_init_script("if (!localStorage.getItem('zip_streak')) "
                      f"localStorage.setItem('zip_streak', {json.dumps(STREAK)});")
    errors = []
    a.on('pageerror', lambda e: errors.append('A ' + str(e)[:200]))
    a.goto(URL); a.wait_for_selector('#syncCard')
    print('A streak shown:', streak_text(a))
    a.click('#syncToggle'); a.click('#syncMakePhrase')
    a.wait_for_selector('#syncPhrase')
    phrase = a.inner_text('#syncPhrase').strip()
    print('phrase:', phrase)
    a.locator('#syncCard').filter(has_text='Cloud: synced').wait_for(timeout=20000)
    lines = a.inner_text('#syncCard').split('\n')
    print('A cloud line:', [l for l in lines if l.startswith('Cloud')])
    print('server groups:', len(groups), 'slices:', [len(g['slices']) for g in groups.values()])

    # ---- device B: fresh, types the phrase
    cb = b.new_context(viewport={'width': 390, 'height': 900})
    cb.route('**/rest/v1/rpc/sync_*', handler)
    bp = cb.new_page()
    bp.on('pageerror', lambda e: errors.append('B ' + str(e)[:200]))
    bp.goto(URL); bp.wait_for_selector('#syncCard')
    print('B streak before:', streak_text(bp))
    bp.click('#syncToggle'); bp.click('#syncHavePhrase')
    bp.fill('#syncPhraseField', phrase.upper().replace(' ', ',  '))
    bp.click('#syncJoin')
    bp.locator('#syncCard').filter(has_text='Joined').wait_for(timeout=30000)
    bp.wait_for_timeout(500)
    print('B note:', [l for l in bp.inner_text('#syncCard').split('\n') if 'Joined' in l])
    print('B streak after:', streak_text(bp))
    bp.screenshot(path='/tmp/e2e-B.png')
    # a wrong phrase is refused in the page
    cc = b.new_context(viewport={'width': 390, 'height': 900})
    cc.route('**/rest/v1/rpc/sync_*', handler)
    c = cc.new_page(); c.goto(URL); c.wait_for_selector('#syncCard')
    c.click('#syncToggle'); c.click('#syncHavePhrase')
    words = phrase.split(); words[3] = 'zazo' if words[3] != 'zazo' else 'zaze'
    c.fill('#syncPhraseField', ' '.join(words)); c.click('#syncJoin'); c.wait_for_timeout(300)
    lines = c.inner_text('#syncCard').split('\n')
    print('C wrong phrase:', [l for l in lines if 'together' in l or 'Word' in l])
    print('C still off (no identity):', c.evaluate("localStorage.getItem('zip_sync')"))
    print('rpc calls:', calls[:8], '... total', len(calls))
    print('page errors:', errors)
    b.close()
