-- Game-of-Day aggregates only: no player data. Run once in the Supabase SQL editor.
create table if not exists gotd_day  (day int primary key, n int not null, sum_ms bigint not null);
create table if not exists gotd_bin  (day int not null, bin smallint not null, n int not null, primary key (day, bin));
create table if not exists gotd_best (day int not null, ms int not null);
create index if not exists gotd_best_day_ms on gotd_best (day, ms);

-- RLS on with no policies: the anon key cannot touch the tables directly, only call the function below.
alter table gotd_day  enable row level security;
alter table gotd_bin  enable row level security;
alter table gotd_best enable row level security;

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
  if to_char(v_date, 'YYYYMMDD')::int <> p_day or abs(v_date - v_today) > 1 then
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

-- Read-only stats for the stats page (aggregates only, public by design). Range <= 90 days, inclusive.
-- Reply: { days: [{ d, n, sum, bins: [[bin, n], ...], best: [ms, ...] }] } ordered by day; same shape as the Worker's GET /stats.
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
      'best', (select coalesce(json_agg(x.ms order by x.ms), '[]'::json) from (select ms from gotd_best where day = d.day order by ms limit 10) x)
    ) order by d.day)
    from gotd_day d where d.day between p_from and p_to), '[]'::json));
end $$;

revoke all on function read_gotd(int, int) from public;
grant execute on function read_gotd(int, int) to anon;
