-- ============================================================================
--  001_usage_and_entitlements.sql
--
--  Server-owned quotas, plan entitlements and a write-only home for each
--  user's own ("bring your own") DeepL key.
--
--  HOW TO APPLY
--  ------------
--  Paste this whole file into the Supabase dashboard -> SQL editor -> Run.
--  It is idempotent: running it again is safe and changes nothing that is
--  already in place. Target: Postgres 15 (Supabase).
--
--  WHAT IT ADDS
--  ------------
--  public.usage          per-user, per-kind, per-month counters. Users may only
--                        READ their own rows; the only way to change a row is
--                        public.consume_usage(), which can only ADD to the
--                        caller's own counters (harmless: you can only spend
--                        your own allowance faster).
--  public.entitlements   plan / valid_until per user. Owner may read; written
--                        ONLY by the service role (a future billing webhook).
--  public.user_keys      the user's own DeepL key. Owner may write it but there
--                        is NO select policy, so the client cannot load it back
--                        into app state. The /api/translate function reads it
--                        with public.get_deepl_key() using the user's own JWT.
--  profiles trigger      stops clients editing the legacy trial/ai counters.
--
--  Counter kinds used by the API (see api/_supa.js):
--    'ai'           one unit per successful OpenAI-backed request (/api/ai)
--    'trial_chars'  characters translated on the SHARED translation key
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
--  1. Usage counters
-- ---------------------------------------------------------------------------
create table if not exists public.usage (
  user_id uuid   not null references auth.users (id) on delete cascade,
  kind    text   not null check (kind ~ '^[a-z_]{1,32}$'),
  month   text   not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),  -- 'YYYY-MM', UTC
  amount  bigint not null default 0 check (amount >= 0),
  primary key (user_id, kind, month)
);

comment on table public.usage is
  'Per-user monthly usage counters. Read-only to the owner; changed only via public.consume_usage().';

alter table public.usage enable row level security;

-- Owner may read their own counters. Deliberately NO insert/update/delete
-- policies: with RLS on, those commands are denied for anon/authenticated.
drop policy if exists "usage: owner can read" on public.usage;
create policy "usage: owner can read"
  on public.usage for select
  to authenticated
  using (user_id = auth.uid());

-- Belt and braces on top of RLS (Supabase grants ALL on new tables by default).
revoke all on table public.usage from anon, authenticated;
grant select on table public.usage to authenticated;

-- Atomically add p_amount to the caller's counter for p_kind in the current
-- UTC month, creating the row if needed, and return the new total.
create or replace function public.consume_usage(p_kind text, p_amount bigint)
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_month text := to_char(now() at time zone 'UTC', 'YYYY-MM');
  v_total bigint;
begin
  if v_uid is null then
    raise exception 'consume_usage: not authenticated' using errcode = '42501';
  end if;
  if p_kind is null or p_kind !~ '^[a-z_]{1,32}$' then
    raise exception 'consume_usage: invalid kind' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 then
    raise exception 'consume_usage: amount must be between 1 and 1000000' using errcode = '22023';
  end if;

  insert into public.usage as u (user_id, kind, month, amount)
  values (v_uid, p_kind, v_month, p_amount)
  on conflict (user_id, kind, month)
    do update set amount = u.amount + excluded.amount
  returning u.amount into v_total;

  return v_total;
end;
$$;

comment on function public.consume_usage(text, bigint) is
  'Adds p_amount (1..1000000) to the caller''s counter for p_kind this UTC month; returns the new total.';

revoke all on function public.consume_usage(text, bigint) from public, anon;
grant execute on function public.consume_usage(text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
--  2. Entitlements (plan per user)
-- ---------------------------------------------------------------------------
create table if not exists public.entitlements (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  plan        text not null default 'free',
  valid_until timestamptz,
  updated_at  timestamptz not null default now()
);

comment on table public.entitlements is
  'Plan per user. Owner may SELECT only. Written ONLY by the service role '
  '(e.g. a future billing webhook using SUPABASE_SERVICE_ROLE_KEY), never by clients.';

alter table public.entitlements enable row level security;

drop policy if exists "entitlements: owner can read" on public.entitlements;
create policy "entitlements: owner can read"
  on public.entitlements for select
  to authenticated
  using (user_id = auth.uid());

revoke all on table public.entitlements from anon, authenticated;
grant select on table public.entitlements to authenticated;

-- ---------------------------------------------------------------------------
--  3. User's own DeepL key (write-only from the client's point of view)
-- ---------------------------------------------------------------------------
create table if not exists public.user_keys (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  deepl_key  text check (deepl_key is null or char_length(deepl_key) <= 200),
  updated_at timestamptz not null default now()
);

comment on table public.user_keys is
  'Each user''s own DeepL key. Owner may insert/update/delete but there is NO select policy, '
  'so the key is never loaded back into the client. Prefer public.set_deepl_key().';

alter table public.user_keys enable row level security;

drop policy if exists "user_keys: owner can insert" on public.user_keys;
create policy "user_keys: owner can insert"
  on public.user_keys for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_keys: owner can update" on public.user_keys;
create policy "user_keys: owner can update"
  on public.user_keys for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_keys: owner can delete" on public.user_keys;
create policy "user_keys: owner can delete"
  on public.user_keys for delete
  to authenticated
  using (user_id = auth.uid());

-- No SELECT grant and no SELECT policy. NOTE: without SELECT, a PostgREST
-- upsert (INSERT ... ON CONFLICT) and an UPDATE/DELETE with a WHERE clause
-- can't see existing rows, so in practice the client and server should use
-- public.set_deepl_key() below rather than writing the table directly.
revoke all on table public.user_keys from anon, authenticated;
grant insert, update, delete on table public.user_keys to authenticated;

-- Does the caller have a key saved? Safe for the client to call.
create or replace function public.has_deepl_key()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_keys k
    where k.user_id = auth.uid()
      and coalesce(btrim(k.deepl_key), '') <> ''
  );
$$;

-- The caller's key, for the SERVER (api/translate.js calls it with the user's
-- own JWT). The user can technically call it too -- it is their own key, so
-- that leaks nothing. The point is that the client never loads the key into
-- app state; it only ever asks has_deepl_key().
create or replace function public.get_deepl_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(btrim(k.deepl_key), '')
  from public.user_keys k
  where k.user_id = auth.uid();
$$;

-- Save (or, with null / empty, remove) the caller's key. Returns whether a key
-- is saved afterwards. api/translate.js validates the key with DeepL first.
create or replace function public.set_deepl_key(p_key text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := nullif(btrim(coalesce(p_key, '')), '');
begin
  if v_uid is null then
    raise exception 'set_deepl_key: not authenticated' using errcode = '42501';
  end if;

  if v_key is null then
    delete from public.user_keys where user_id = v_uid;
    return false;
  end if;

  if char_length(v_key) > 200 then
    raise exception 'set_deepl_key: key too long' using errcode = '22023';
  end if;

  insert into public.user_keys as k (user_id, deepl_key, updated_at)
  values (v_uid, v_key, now())
  on conflict (user_id)
    do update set deepl_key = excluded.deepl_key, updated_at = now();
  return true;
end;
$$;

revoke all on function public.has_deepl_key()     from public, anon;
revoke all on function public.get_deepl_key()     from public, anon;
revoke all on function public.set_deepl_key(text) from public, anon;
grant execute on function public.has_deepl_key()     to authenticated;
grant execute on function public.get_deepl_key()     to authenticated;
grant execute on function public.set_deepl_key(text) to authenticated;

-- ---------------------------------------------------------------------------
--  4. Legacy profiles columns
--     - copy profiles.deepl_key into user_keys (old column is NOT dropped)
--     - mark trial_used / ai_used as unused
--     - stop clients editing the legacy counters
-- ---------------------------------------------------------------------------

-- Copy existing keys. ON CONFLICT DO NOTHING: a re-run never overwrites a key
-- the user has since saved through set_deepl_key().
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'deepl_key'
  ) then
    execute $sql$
      insert into public.user_keys (user_id, deepl_key, updated_at)
      select p.id, btrim(p.deepl_key), now()
      from public.profiles p
      join auth.users u on u.id = p.id
      where p.deepl_key is not null
        and btrim(p.deepl_key) <> ''
        and char_length(btrim(p.deepl_key)) <= 200
      on conflict (user_id) do nothing
    $sql$;
  end if;
end;
$$;

-- Comments on the legacy columns, where they exist.
do $$
declare
  c text;
begin
  foreach c in array array['trial_used', 'trial_month', 'ai_used', 'ai_month'] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = c
    ) then
      execute format(
        'comment on column public.profiles.%I is %L', c,
        'UNUSED since migration 001: quotas now live in public.usage. Kept for history; frozen for clients by a trigger.'
      );
    end if;
  end loop;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'deepl_key'
  ) then
    execute format(
      'comment on column public.profiles.deepl_key is %L',
      'LEGACY since migration 001: copied into public.user_keys. The app no longer reads or writes it.'
    );
  end if;
end;
$$;

-- Trigger function: for client roles (anon / authenticated, i.e. anything
-- coming through PostgREST with a user or anon JWT) keep the legacy counters
-- unchanged on UPDATE and at their defaults on INSERT. The service role, the
-- SQL editor (postgres) and SECURITY DEFINER functions are unaffected.
-- Written against jsonb so it works whichever of the four columns exist.
-- NOT security definer on purpose: current_user must be the calling role.
create or replace function public.profiles_freeze_legacy_counters()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_new   jsonb := to_jsonb(new);
  v_old   jsonb;
  v_patch jsonb := '{}'::jsonb;
  c       text;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
  end if;

  foreach c in array array['trial_used', 'trial_month', 'ai_used', 'ai_month'] loop
    if v_new ? c then
      if tg_op = 'UPDATE' then
        v_patch := v_patch || jsonb_build_object(c, v_old -> c);
      elsif c in ('trial_used', 'ai_used') then
        v_patch := v_patch || jsonb_build_object(c, 0);
      else
        v_patch := v_patch || jsonb_build_object(c, '');
      end if;
    end if;
  end loop;

  if v_patch <> '{}'::jsonb then
    new := jsonb_populate_record(new, v_patch);
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_freeze_legacy_counters() from public, anon, authenticated;

-- Attach it only if profiles exists and has at least one of the columns.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('trial_used', 'trial_month', 'ai_used', 'ai_month')
  ) then
    execute 'drop trigger if exists profiles_freeze_legacy_counters on public.profiles';
    execute 'create trigger profiles_freeze_legacy_counters
               before insert or update on public.profiles
               for each row execute function public.profiles_freeze_legacy_counters()';
  end if;
end;
$$;

commit;
