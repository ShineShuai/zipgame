-- Device sync (src/platform/sync/cloud): the encrypted slices of a player's devices, so that devices that are never
-- open together can still meet. Run once in the Supabase SQL editor (idempotent). Run schema.sql first (it makes gotd_secret).
--
-- What is stored is ciphertext made on the player's device with a key the server never sees (src/core/sync/cloud-keys.js):
-- a group id (random-looking), the verifier of an auth value, and per device one sealed slice with a counter and a time.
-- Not even the player's statistics can be read from it. Still it is data about players (when a group wrote last, how
-- often, from how many devices), unlike the Game-of-Day tables of schema.sql, which hold aggregates only.
--
-- RLS on with no policies: the anon key cannot touch the tables, only call the functions below. The group is claimed
-- by its first write (the hash of the group's auth value is stored); every later write and the delete must show the
-- same auth value. Reading needs only the id: it is 128 random-looking bits nobody can list or guess.
-- Invalid input -> SQLSTATE 22023 (HTTP 400, message 'invalid'); wrong auth -> 42501 (HTTP 401/403); the server is full -> 53400
-- (HTTP 503, 'closed'); two writes of one device within 5 seconds -> 'busy' (HTTP 400, retry later).

create table if not exists sync_owner (
  id text primary key check (id ~ '^[0-9a-f]{32}$'),
  verifier text not null,
  touched timestamptz not null default now()
);
create table if not exists sync_slice (
  id text not null references sync_owner (id) on delete cascade,
  dev text not null check (dev ~ '^[A-Za-z0-9_-]{11}$'),
  seq bigint not null check (seq >= 1),
  data text not null check (length(data) between 16 and 24000 and data ~ '^[A-Za-z0-9_-]+$'),
  touched timestamptz not null default now(),
  primary key (id, dev)
);
-- The ceiling and the off switch, changed by you in the SQL editor:
--   update sync_cfg set n = 0 where name = 'max_groups';       no new group is accepted any more
--   update sync_cfg set n = 100000 where name = 'max_groups';  the default
create table if not exists sync_cfg (name text primary key, n bigint not null);
insert into sync_cfg (name, n) values ('max_groups', 100000) on conflict (name) do nothing;
-- sha256 (hex) of the pruning token, inserted once by hand with name 'sync-prune' (server/README.md, "Device sync").
create table if not exists gotd_secret (name text primary key, hash text not null);

alter table sync_owner enable row level security;
alter table sync_slice enable row level security;
alter table sync_cfg enable row level security;
alter table gotd_secret enable row level security;

-- Writes this device's slice. A repeat with a seq that is not newer changes nothing (stored: false).
create or replace function sync_put(p_id text, p_auth text, p_dev text, p_seq bigint, p_data text) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_hash text; v_have text; v_rows int;
begin
  if p_id is null or p_id !~ '^[0-9a-f]{32}$' or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{43}$'
     or p_dev is null or p_dev !~ '^[A-Za-z0-9_-]{11}$' or p_seq is null or p_seq < 1 or p_seq > 9007199254740991
     or p_data is null or length(p_data) not between 16 and 24000 or p_data !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_auth, 'UTF8')), 'hex');

  if not exists (select 1 from sync_owner where id = p_id) then
    if (select count(*) from sync_owner) >= coalesce((select n from sync_cfg where name = 'max_groups'), 0) then
      raise exception 'closed' using errcode = '53400';
    end if;
    insert into sync_owner (id, verifier) values (p_id, v_hash) on conflict (id) do nothing;
  end if;
  -- the row lock serialises the writes of one group
  select verifier into v_have from sync_owner where id = p_id for update;
  if v_have is distinct from v_hash then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- at most 8 devices per group (SYNC.maxDevices of src/config.js is 2..8)
  if not exists (select 1 from sync_slice where id = p_id and dev = p_dev)
     and (select count(*) from sync_slice where id = p_id) >= 8 then
    raise exception 'invalid' using errcode = '22023';
  end if;
  if exists (select 1 from sync_slice where id = p_id and dev = p_dev and touched > now() - interval '5 seconds') then
    raise exception 'busy';
  end if;

  insert into sync_slice as s (id, dev, seq, data) values (p_id, p_dev, p_seq, p_data)
    on conflict (id, dev) do update set seq = excluded.seq, data = excluded.data, touched = now()
    where s.seq < excluded.seq;
  get diagnostics v_rows = row_count;
  update sync_owner set touched = now() where id = p_id;
  return json_build_object('ok', true, 'stored', v_rows > 0);
end $$;

revoke all on function sync_put(text, text, text, bigint, text) from public;
grant execute on function sync_put(text, text, text, bigint, text) to anon;

-- The slices of a group that are newer than what the caller has: p_have = { "<dev>": <seq> }.
-- An id nobody uses gives an empty list, like an id that is used: nothing tells them apart.
create or replace function sync_get(p_id text, p_have jsonb default '{}'::jsonb) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if p_id is null or p_id !~ '^[0-9a-f]{32}$' or p_have is null or jsonb_typeof(p_have) <> 'object' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  return json_build_object('slices', coalesce((
    select json_agg(json_build_object('dev', s.dev, 'seq', s.seq, 'data', s.data) order by s.dev)
    from sync_slice s
    where s.id = p_id
      and s.seq > coalesce(case when (p_have ->> s.dev) ~ '^[0-9]{1,15}$' then (p_have ->> s.dev)::bigint end, 0)
  ), '[]'::json));
end $$;

revoke all on function sync_get(text, jsonb) from public;
grant execute on function sync_get(text, jsonb) to anon;

-- Deletes the whole group (its slices go with it). Wrong auth -> 42501; no such group -> { deleted: false }.
create or replace function sync_delete(p_id text, p_auth text) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_hash text; v_have text;
begin
  if p_id is null or p_id !~ '^[0-9a-f]{32}$' or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_auth, 'UTF8')), 'hex');
  select verifier into v_have from sync_owner where id = p_id for update;
  if not found then
    return json_build_object('deleted', false);
  end if;
  if v_have <> v_hash then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  delete from sync_owner where id = p_id;
  return json_build_object('deleted', true);
end $$;

revoke all on function sync_delete(text, text) from public;
grant execute on function sync_delete(text, text) to anon;

-- Removes the groups that wrote nothing for p_days days (7..3650). Needs the pruning token (tools/sync-prune.mjs, or
-- pg_cron: server/README.md): wrong token -> 42501.
create or replace function sync_prune(p_token text, p_days int) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  if p_token is null or not exists (select 1 from gotd_secret where name = 'sync-prune' and hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 7 and 3650 then
    raise exception 'invalid' using errcode = '22023';
  end if;
  delete from sync_owner where touched < now() - make_interval(days => p_days);
  get diagnostics v_rows = row_count;
  return json_build_object('deleted', v_rows);
end $$;

revoke all on function sync_prune(text, int) from public;
grant execute on function sync_prune(text, int) to anon;
