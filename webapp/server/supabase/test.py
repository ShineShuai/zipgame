#!/usr/bin/env python3
"""Verifies schema.sql's submit_gotd() against a brute-force model on a scratch Postgres.
Usage: PGHOST=/tmp PGPORT=5544 PGUSER=postgres python3 server/supabase/test.py   (needs psql; creates and drops database gotd_test)"""
import datetime, json, math, os, random, subprocess, sys, pathlib

NB, TOP_K = 80, 10
def bin_of(ms): return min(NB - 1, math.floor(math.log(ms / 1000) / math.log(1.1))) if ms > 1000 else 0
def psql(sql, db='gotd_test', role=None, check=True):
    pre = f'set role {role};' if role else ''
    p = subprocess.run(['psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', db, '-c', pre + sql], capture_output=True, text=True)
    if check and p.returncode: raise SystemExit(p.stderr)
    return p

psql('drop database if exists gotd_test', 'postgres'); psql('create database gotd_test', 'postgres')
psql("do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$")
psql(pathlib.Path(__file__).with_name('schema.sql').read_text())
today = datetime.datetime.now(datetime.timezone.utc).date()
ymd = lambda d: int(d.strftime('%Y%m%d'))
call = lambda d, t, b, role='anon': psql(f'select submit_gotd({d},{t},{b})', role=role, check=False)

random.seed(7); times = []
for i in range(300):
    t = round(1000 * math.exp(random.random() * math.log(2000))); b = bin_of(t); times.append(t)
    p = call(ymd(today), t, b)
    assert p.returncode == 0, p.stderr
    r = json.loads(p.stdout.strip().splitlines()[-1])
    exp = dict(n=len(times), sum=sum(times), below=sum(bin_of(x) < b for x in times), cnt=sum(bin_of(x) == b for x in times), best=sorted(times)[:TOP_K])
    assert r == exp, (i, r, exp)
print('ok    300 random submits match the model (n, sum, below, cnt, best)')

for d in (today - datetime.timedelta(1), today + datetime.timedelta(1)):
    assert call(ymd(d), 5000, 3).returncode == 0
print('ok    day +-1 accepted')
bad = [(ymd(today - datetime.timedelta(2)), 5000, 3), (ymd(today + datetime.timedelta(2)), 5000, 3), (20260231, 5000, 3), (20261301, 5000, 3),
       (ymd(today), 499, 3), (ymd(today), 3600001, 3), (ymd(today), 5000, -1), (ymd(today), 5000, 80), ('null', 5000, 3), (ymd(today), 'null', 3), (ymd(today), 5000, 'null')]
for a in bad:
    p = call(*a); assert p.returncode and '22023' in p.stderr, (a, p.stderr)
print(f'ok    {len(bad)} invalid inputs rejected with SQLSTATE 22023 (PostgREST -> HTTP 400)')

# read_gotd: same numbers as the brute-force model, range validation, anon may call it
read = lambda a, b: psql(f'select read_gotd({a},{b})', role='anon', check=False)
p = read(ymd(today - datetime.timedelta(1)), ymd(today)); assert p.returncode == 0, p.stderr
days = json.loads(p.stdout.strip().splitlines()[-1])['days']
assert [x['d'] for x in days] == [ymd(today - datetime.timedelta(1)), ymd(today)], days
t = days[1]; assert t['n'] == len(times) and t['sum'] == sum(times) and t['best'] == sorted(times)[:TOP_K], t
exp_bins = {}
for x in times: exp_bins[bin_of(x)] = exp_bins.get(bin_of(x), 0) + 1
assert t['bins'] == [[k, exp_bins[k]] for k in sorted(exp_bins)], t['bins']
assert days[0]['n'] == 1 and days[0]['best'] == [5000] and days[0]['bins'] == [[3, 1]], days[0]
assert json.loads(read(ymd(today - datetime.timedelta(60)), ymd(today - datetime.timedelta(50))).stdout.strip().splitlines()[-1]) == {'days': []}
lo = today - datetime.timedelta(89)
assert read(ymd(lo), ymd(today)).returncode == 0
for a, b in [(ymd(lo) - 1, ymd(today)), (ymd(today), ymd(today - datetime.timedelta(1))), (20260231, ymd(today)), (ymd(today), 20261301), (5, ymd(today)), ('null', ymd(today)), (ymd(today), 'null')]:
    p = read(a, b); assert p.returncode and '22023' in p.stderr, (a, b, p.stderr)
print('ok    read_gotd matches the model, empty range, 90-day cap, 7 invalid ranges rejected with SQLSTATE 22023')

sizes = {r.split('|')[0]: int(r.split('|')[1]) for r in psql("select 'gotd_day', count(*) from gotd_day union all select 'gotd_best', count(*) from gotd_best union all select 'gotd_bin', count(*) from gotd_bin").stdout.split() if r}
assert sizes['gotd_day'] == 3 and sizes['gotd_best'] <= 10 * 3 and sizes['gotd_bin'] <= 80 * 3, sizes
print('ok    row counts bounded', sizes)

for t in ('gotd_day', 'gotd_bin', 'gotd_best'):
    p = psql(f'select * from {t}', role='anon', check=False); assert p.returncode, f'anon can read {t}'
    p = psql(f'insert into {t} select * from {t} limit 0', role='anon', check=False); assert p.returncode, f'anon can write {t}'
print('ok    anon cannot touch the tables directly, only call submit_gotd / read_gotd')
psql('drop database gotd_test', 'postgres')
