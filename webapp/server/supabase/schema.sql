-- Game-of-Day aggregates only: no player data. Run once in the Supabase SQL editor.
create table if not exists gotd_day  (day int primary key, n int not null, sum_ms bigint not null);
create table if not exists gotd_bin  (day int not null, bin smallint not null, n int not null, primary key (day, bin));
create table if not exists gotd_best (day int not null, ms int not null);
create index if not exists gotd_best_day_ms on gotd_best (day, ms);
-- Synthetic seed players of a day (tools/gotd-seed.mjs), already counted in the three tables above. The row is also the "already seeded" gate.
create table if not exists gotd_seed (day int primary key, ms int[] not null);
-- sha256 (hex) of the seed token, inserted once by hand (server/README.md); anon can neither read nor write it.
create table if not exists gotd_secret (name text primary key, hash text not null);

-- RLS on with no policies: the anon key cannot touch the tables directly, only call the function below.
alter table gotd_day  enable row level security;
alter table gotd_bin  enable row level security;
alter table gotd_best enable row level security;
alter table gotd_seed enable row level security;
alter table gotd_secret enable row level security;

-- Mirrors src/core/hist.js (NB = 80, TOP_K = 10, MIN_MS = 500, MAX_MS = 3600000) and server/cloudflare/worker.js.
-- Invalid input -> SQLSTATE 22023 -> HTTP 400 (the client treats 400/422 as "rejected", not as a reason to fail over).
create or replace function submit_gotd(p_day int, p_ms int, p_bin int) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_date date;
  v_n int; v_sum bigint; v_cnt int; v_below bigint; v_best json;
begin
  if p_ms is null or p_bin is null or p_day is null or p_ms < 500 or p_ms > 3600000 or p_bin < 0 or p_bin >= 80 then
    raise exception 'invalid' using errcode = '22023';
  end if;
  begin
    v_date := to_date(p_day::text, 'YYYYMMDD');
  exception when others then
    raise exception 'invalid' using errcode = '22023';
  end;
  -- Up to REPLAY_DAYS + 1 days back (REPLAY_DAYS = 90 in src/core/hist.js, so 91; worker.test.mjs fails when the two differ), like the Worker; 1 day ahead for clock skew.
  -- Temporary: change the number back to 1 to stop accepting replays.
  if to_char(v_date, 'YYYYMMDD')::int <> p_day or v_date - v_today > 1 or v_today - v_date > 91 then
    raise exception 'invalid' using errcode = '22023';
  end if;

  -- The upsert on gotd_day takes the day's row lock, which serialises concurrent submits for the same day.
  insert into gotd_day as d (day, n, sum_ms) values (p_day, 1, p_ms)
    on conflict (day) do update set n = d.n + 1, sum_ms = d.sum_ms + excluded.sum_ms
    returning d.n, d.sum_ms into v_n, v_sum;
  insert into gotd_bin as b (day, bin, n) values (p_day, p_bin, 1)
    on conflict (day, bin) do update set n = b.n + 1
    returning b.n into v_cnt;
  select coalesce(sum(n), 0) into v_below from gotd_bin where day = p_day and bin < p_bin;

  if (select count(*) from gotd_best where day = p_day) < 10 or p_ms < (select max(ms) from gotd_best where day = p_day) then
    insert into gotd_best (day, ms) values (p_day, p_ms);
    delete from gotd_best where ctid in (select ctid from gotd_best where day = p_day order by ms offset 10);
  end if;
  select coalesce(json_agg(ms order by ms), '[]'::json) into v_best from (select ms from gotd_best where day = p_day order by ms limit 10) x;

  return json_build_object('n', v_n, 'sum', v_sum, 'below', v_below, 'cnt', v_cnt, 'best', v_best);
end $$;

revoke all on function submit_gotd(int, int, int) from public;
grant execute on function submit_gotd(int, int, int) to anon;

-- Adds 1..8 synthetic players to a day, once per day: a repeat answers {status: exists} and changes nothing.
-- Needs the seed token (its sha256 is in gotd_secret): wrong token -> SQLSTATE 42501 (HTTP 401/403), invalid input -> 22023 (HTTP 400).
create or replace function seed_gotd(p_token text, p_day int, p_ms int[], p_bin int[]) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_date date;
  v_rows int; v_n int; v_sum bigint;
begin
  if p_token is null or not exists (select 1 from gotd_secret where name = 'seed' and hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_day is null or p_ms is null or p_bin is null or coalesce(array_length(p_ms, 1), 0) not between 1 and 8 or array_length(p_ms, 1) <> coalesce(array_length(p_bin, 1), 0)
     or exists (select 1 from unnest(p_ms) m where m is null or m < 500 or m > 3600000)
     or exists (select 1 from unnest(p_bin) b where b is null or b < 0 or b >= 80) then
    raise exception 'invalid' using errcode = '22023';
  end if;
  begin
    v_date := to_date(p_day::text, 'YYYYMMDD');
  exception when others then
    raise exception 'invalid' using errcode = '22023';
  end;
  if to_char(v_date, 'YYYYMMDD')::int <> p_day or abs(v_date - v_today) > 1 then
    raise exception 'invalid' using errcode = '22023';
  end if;

  insert into gotd_seed (day, ms) values (p_day, p_ms) on conflict (day) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return json_build_object('status', 'exists'); end if;

  insert into gotd_day as d (day, n, sum_ms) select p_day, count(*), sum(m) from unnest(p_ms) m
    on conflict (day) do update set n = d.n + excluded.n, sum_ms = d.sum_ms + excluded.sum_ms
    returning d.n, d.sum_ms into v_n, v_sum;
  insert into gotd_bin as b (day, bin, n) select p_day, x, count(*) from unnest(p_bin) x group by x
    on conflict (day, bin) do update set n = b.n + excluded.n;
  insert into gotd_best (day, ms) select p_day, m from unnest(p_ms) m;
  delete from gotd_best where ctid in (select ctid from gotd_best where day = p_day order by ms offset 10);
  return json_build_object('status', 'ok', 'n', v_n, 'sum', v_sum);
end $$;

revoke all on function seed_gotd(text, int, int[], int[]) from public;
grant execute on function seed_gotd(text, int, int[], int[]) to anon;

-- Read-only stats for the stats page (aggregates only, public by design). Range <= 90 days, inclusive.
-- Reply: { days: [{ d, n, sum, bins: [[bin, n], ...], best: [ms, ...], seeds: [ms, ...] }] } ordered by day; same shape as the Worker's GET /stats.
create or replace function read_gotd(p_from int, p_to int) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_from date; v_to date;
begin
  begin
    v_from := to_date(p_from::text, 'YYYYMMDD'); v_to := to_date(p_to::text, 'YYYYMMDD');
  exception when others then
    raise exception 'invalid' using errcode = '22023';
  end;
  if v_from is null or v_to is null or to_char(v_from, 'YYYYMMDD')::int <> p_from or to_char(v_to, 'YYYYMMDD')::int <> p_to or v_to < v_from or v_to - v_from > 89 then
    raise exception 'invalid' using errcode = '22023';
  end if;
  return json_build_object('days', coalesce((
    select json_agg(json_build_object(
      'd', d.day, 'n', d.n, 'sum', d.sum_ms,
      'bins', (select coalesce(json_agg(json_build_array(b.bin, b.n) order by b.bin), '[]'::json) from gotd_bin b where b.day = d.day),
      'best', (select coalesce(json_agg(x.ms order by x.ms), '[]'::json) from (select ms from gotd_best where day = d.day order by ms limit 10) x),
      'seeds', coalesce((select json_agg(x order by x) from gotd_seed s, unnest(s.ms) x where s.day = d.day), '[]'::json)
    ) order by d.day)
    from gotd_day d where d.day between p_from and p_to), '[]'::json));
end $$;

revoke all on function read_gotd(int, int) from public;
grant execute on function read_gotd(int, int) to anon;
