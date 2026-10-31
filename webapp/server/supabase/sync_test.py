#!/usr/bin/env python3
"""Checks sync.sql (the device sync functions) on a scratch Postgres, as test.py does for submit_gotd().
Usage: PGHOST=/tmp PGPORT=5544 PGUSER=postgres python3 server/supabase/sync_test.py
(needs psql; creates and drops the database sync_test).

NOTE: written where no Postgres was at hand, so it has not been run. If a check fails, look at both sides:
the SQL in sync.sql and the expectation here (server/supabase/sync.sql is modelled in test/sync/helpers.js
fakeSupabase(), which the page's tests run against)."""
import json, pathlib, subprocess

ID = 'a1' * 16
AUTH = 'A' * 43
OTHER = 'B' * 43
DEV = 'AAAAAAAAAAA'
def data(n): return f'sealed-{n}'.ljust(40, 'x')

def psql(sql, db='sync_test', role=None, check=True):
    pre = f'set role {role};' if role else ''
    p = subprocess.run(['psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', db, '-c', pre + sql],
                       capture_output=True, text=True)
    if check and p.returncode: raise SystemExit(p.stderr)
    return p

def call(fn, *args, role='anon'):
    q = ', '.join('null' if a is None else (f"'{a}'" if isinstance(a, str) else str(a)) for a in args)
    return psql(f'select {fn}({q})', role=role, check=False)

def result(p):
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout.strip().splitlines()[-1])

def refused(p, sqlstate):
    assert p.returncode != 0 and sqlstate in p.stderr, (sqlstate, p.stderr)

root = pathlib.Path(__file__).parent
psql('drop database if exists sync_test', 'postgres'); psql('create database sync_test', 'postgres')
psql("do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$")
psql((root / 'schema.sql').read_text())  # gotd_secret
psql((root / 'sync.sql').read_text())
psql((root / 'sync.sql').read_text())  # idempotent

# the tables are not readable by the anon role: only the functions are
assert psql('select count(*) from sync_slice', role='anon', check=False).returncode != 0
print('ok    anon cannot read the tables')

# put and get
assert result(call('sync_put', ID, AUTH, DEV, 1, data(1))) == {'ok': True, 'stored': True}
got = result(call('sync_get', ID, '{}'))
assert got == {'slices': [{'dev': DEV, 'seq': 1, 'data': data(1)}]}, got
assert result(call('sync_get', ID, json.dumps({DEV: 1})))['slices'] == []
assert result(call('sync_get', ID, json.dumps({DEV: 0})))['slices'] != []
assert result(call('sync_get', 'f' * 32, '{}')) == {'slices': []}
print('ok    put, get, get with have, a group nobody uses')

# writes of one device are at least 5 seconds apart (busy = P0001), a stale seq stores nothing
p = call('sync_put', ID, AUTH, DEV, 2, data(2)); assert p.returncode != 0 and 'busy' in p.stderr, p.stderr
psql("update sync_slice set touched = now() - interval '10 seconds'")
assert result(call('sync_put', ID, AUTH, DEV, 1, data(1)))['stored'] is False
assert result(call('sync_put', ID, AUTH, DEV, 5, data(5)))['stored'] is True
print('ok    busy, stale, newer')

# only the holder of the auth value writes or deletes
refused(call('sync_put', ID, OTHER, 'CCCCCCCCCCC', 1, data(3)), '42501')
refused(call('sync_delete', ID, OTHER), '42501')
print('ok    wrong auth refused')

# invalid input
bad = [('short', AUTH, DEV, 1, data(1)), (ID, 'x', DEV, 1, data(1)), (ID, AUTH, 'bad', 1, data(1)), (ID, AUTH, DEV, 0, data(1)),
       (ID, AUTH, DEV, 1, 'tiny'), (ID, AUTH, DEV, 1, 'x' * 24001), (ID, AUTH, DEV, 1, data(1) + ' !'), (None, AUTH, DEV, 1, data(1))]
for args in bad: refused(call('sync_put', *args), '22023')
refused(call('sync_get', 'short', '{}'), '22023'); refused(call('sync_get', ID, '[]'), '22023')
print('ok    invalid input refused')

# at most 8 devices
for i in range(7): assert result(call('sync_put', ID, AUTH, f'DEVICE0000{i}', 1, data(i)))['stored'] is True
refused(call('sync_put', ID, AUTH, 'DEVICE00009', 1, data(9)), '22023')
print('ok    a ninth device refused')

# the ceiling
psql("update sync_cfg set n = 0 where name = 'max_groups'")
refused(call('sync_put', 'b2' * 16, AUTH, DEV, 1, data(1)), '53400')
psql("update sync_cfg set n = 100000 where name = 'max_groups'")
print('ok    closed at the ceiling')

# delete, then pruning with the token
assert result(call('sync_delete', ID, AUTH)) == {'deleted': True}
assert result(call('sync_delete', ID, AUTH)) == {'deleted': False}
assert result(call('sync_get', ID, '{}')) == {'slices': []}
assert result(call('sync_put', ID, AUTH, DEV, 1, data(1)))['stored'] is True
refused(call('sync_prune', 'nope', 180), '42501')
psql("insert into gotd_secret (name, hash) values ('sync-prune', encode(sha256(convert_to('prune-token', 'UTF8')), 'hex'))")
refused(call('sync_prune', 'prune-token', 3), '22023')
assert result(call('sync_prune', 'prune-token', 180)) == {'deleted': 0}
psql("update sync_owner set touched = now() - interval '200 days'")
assert result(call('sync_prune', 'prune-token', 180)) == {'deleted': 1}
assert psql('select count(*) from sync_slice').stdout.strip() == '0', 'slices go with their group'
print('ok    delete, prune')
psql('drop database sync_test', 'postgres', check=False)
print('all ok')
