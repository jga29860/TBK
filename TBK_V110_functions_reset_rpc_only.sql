
-- ============================================================
-- TBK V110 - Reset tournoi cote RPC uniquement
-- Objectif : deplacer toute la logique d'export, suppression,
-- recreation minimale et audit cote Supabase/PostgreSQL.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- 1. Table de verrou applicatif pour operations sensibles
-- ============================================================
create table if not exists public.app_locks (
    id uuid primary key default gen_random_uuid(),
    lock_key text not null unique,
    status text not null default 'active',
    locked_by text,
    locked_at timestamptz not null default now(),
    expires_at timestamptz,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create or replace function public.tbk_set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_app_locks_updated_at on public.app_locks;
create trigger trg_app_locks_updated_at
before update on public.app_locks
for each row execute function public.tbk_set_updated_at();

alter table public.app_locks enable row level security;

drop policy if exists app_locks_all_authenticated on public.app_locks;
create policy app_locks_all_authenticated
on public.app_locks
for all
to authenticated
using (true)
with check (true);

-- ============================================================
-- 2. Fonction utilitaire : insertion audit si table presente
-- ============================================================
create or replace function public.tbk_try_audit(
    p_action text,
    p_table_name text default null,
    p_record_id uuid default null,
    p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if to_regclass('public.audit_logs') is not null then
        insert into public.audit_logs(user_id, action, table_name, record_id, details, created_at)
        values (auth.uid(), p_action, p_table_name, p_record_id, coalesce(p_details, '{}'::jsonb), now());
    end if;
exception when others then
    -- Ne jamais bloquer une operation importante pour un probleme d'audit
    null;
end;
$$;

-- ============================================================
-- 3. Export SQL du tournoi sous forme texte
-- ============================================================
drop function if exists public.tbk_rpc_export_tournament_sql(text, text);

create or replace function public.tbk_rpc_export_tournament_sql(
    p_season_label text,
    p_tournament_name text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tournament_id uuid;
    v_sql text := '';
    r record;
begin
    select t.id
    into v_tournament_id
    from public.tournaments t
    join public.club_seasons s on s.id = t.season_id
    where s.label = p_season_label
      and t.name = p_tournament_name
    limit 1;

    if v_tournament_id is null then
        raise exception 'Tournoi introuvable pour saison % et nom %', p_season_label, p_tournament_name;
    end if;

    v_sql := v_sql || '-- ============================================================' || chr(10);
    v_sql := v_sql || '-- TBK V110 - Export SQL tournoi avant reset' || chr(10);
    v_sql := v_sql || '-- Saison : ' || p_season_label || chr(10);
    v_sql := v_sql || '-- Tournoi : ' || p_tournament_name || chr(10);
    v_sql := v_sql || '-- Genere le : ' || now()::text || chr(10);
    v_sql := v_sql || '-- ============================================================' || chr(10) || chr(10);
    v_sql := v_sql || 'begin;' || chr(10) || chr(10);

    -- Nettoyage cible avant reinjection
    v_sql := v_sql || '-- Nettoyage avant reinjection' || chr(10);
    v_sql := v_sql || format('delete from public.tournament_match_events where match_id in (select m.id from public.tournament_matches m join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = %L);%s', v_tournament_id, chr(10));
    v_sql := v_sql || format('delete from public.tournament_court_assignments where match_id in (select m.id from public.tournament_matches m join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = %L);%s', v_tournament_id, chr(10));
    v_sql := v_sql || format('delete from public.tournament_match_sets where match_id in (select m.id from public.tournament_matches m join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = %L);%s', v_tournament_id, chr(10));
    v_sql := v_sql || format('delete from public.tournament_matches where competition_id in (select id from public.tournament_competitions where tournament_id = %L);%s', v_tournament_id, chr(10));
    v_sql := v_sql || format('delete from public.tournament_checkins where team_player_id in (select tp.id from public.tournament_team_players tp join public.tournament_teams tm on tm.id = tp.team_id join public.tournament_competitions c on c.id = tm.competition_id where c.tournament_id = %L);%s', v_tournament_id, chr(10));
    v_sql := v_sql || format('delete from public.tournament_team_players where team_id in (select tm.id from public.tournament_teams tm join public.tournament_competitions c on c.id = tm.competition_id where c.tournament_id = %L);%s', v_tournament_id, chr(10));
    v_sql := v_sql || format('delete from public.tournament_teams where competition_id in (select id from public.tournament_competitions where tournament_id = %L);%s', v_tournament_id, chr(10));
    v_sql := v_sql || format('delete from public.tournament_pools where competition_id in (select id from public.tournament_competitions where tournament_id = %L);%s', v_tournament_id, chr(10));
    v_sql := v_sql || format('delete from public.tournament_courts where tournament_id = %L;%s', v_tournament_id, chr(10));
    v_sql := v_sql || format('delete from public.tournament_state_snapshots where tournament_id = %L;%s', v_tournament_id, chr(10));
    v_sql := v_sql || format('delete from public.tournament_competitions where tournament_id = %L;%s', v_tournament_id, chr(10));
    v_sql := v_sql || format('delete from public.tournaments where id = %L;%s%s', v_tournament_id, chr(10), chr(10));

    v_sql := v_sql || '-- Reinjection des donnees' || chr(10);

    for r in select to_jsonb(t.*) as j from public.tournaments t where t.id = v_tournament_id loop
        v_sql := v_sql || format('insert into public.tournaments select * from jsonb_populate_record(null::public.tournaments, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
    end loop;

    for r in select to_jsonb(c.*) as j from public.tournament_competitions c where c.tournament_id = v_tournament_id order by c.sort_order, c.competition_key loop
        v_sql := v_sql || format('insert into public.tournament_competitions select * from jsonb_populate_record(null::public.tournament_competitions, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
    end loop;

    for r in select to_jsonb(p.*) as j from public.tournament_pools p join public.tournament_competitions c on c.id = p.competition_id where c.tournament_id = v_tournament_id order by c.competition_key, p.sort_order loop
        v_sql := v_sql || format('insert into public.tournament_pools select * from jsonb_populate_record(null::public.tournament_pools, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
    end loop;

    for r in select to_jsonb(court.*) as j from public.tournament_courts court where court.tournament_id = v_tournament_id order by court.court_number loop
        v_sql := v_sql || format('insert into public.tournament_courts select * from jsonb_populate_record(null::public.tournament_courts, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
    end loop;

    for r in select to_jsonb(tm.*) as j from public.tournament_teams tm join public.tournament_competitions c on c.id = tm.competition_id where c.tournament_id = v_tournament_id order by c.competition_key, tm.team_number loop
        v_sql := v_sql || format('insert into public.tournament_teams select * from jsonb_populate_record(null::public.tournament_teams, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
    end loop;

    for r in select to_jsonb(tp.*) as j from public.tournament_team_players tp join public.tournament_teams tm on tm.id = tp.team_id join public.tournament_competitions c on c.id = tm.competition_id where c.tournament_id = v_tournament_id order by c.competition_key, tm.team_number, tp.player_order loop
        v_sql := v_sql || format('insert into public.tournament_team_players select * from jsonb_populate_record(null::public.tournament_team_players, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
    end loop;

    for r in select to_jsonb(ch.*) as j from public.tournament_checkins ch join public.tournament_team_players tp on tp.id = ch.team_player_id join public.tournament_teams tm on tm.id = tp.team_id join public.tournament_competitions c on c.id = tm.competition_id where c.tournament_id = v_tournament_id order by c.competition_key, tm.team_number, tp.player_order loop
        v_sql := v_sql || format('insert into public.tournament_checkins select * from jsonb_populate_record(null::public.tournament_checkins, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
    end loop;

    for r in select to_jsonb(m.*) as j from public.tournament_matches m join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = v_tournament_id order by c.competition_key, m.match_number loop
        v_sql := v_sql || format('insert into public.tournament_matches select * from jsonb_populate_record(null::public.tournament_matches, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
    end loop;

    for r in select to_jsonb(ms.*) as j from public.tournament_match_sets ms join public.tournament_matches m on m.id = ms.match_id join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = v_tournament_id order by c.competition_key, m.match_number, ms.set_number loop
        v_sql := v_sql || format('insert into public.tournament_match_sets select * from jsonb_populate_record(null::public.tournament_match_sets, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
    end loop;

    for r in select to_jsonb(ca.*) as j from public.tournament_court_assignments ca join public.tournament_matches m on m.id = ca.match_id join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = v_tournament_id order by ca.assigned_at loop
        v_sql := v_sql || format('insert into public.tournament_court_assignments select * from jsonb_populate_record(null::public.tournament_court_assignments, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
    end loop;

    for r in select to_jsonb(ev.*) as j from public.tournament_match_events ev join public.tournament_matches m on m.id = ev.match_id join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = v_tournament_id order by ev.created_at loop
        v_sql := v_sql || format('insert into public.tournament_match_events select * from jsonb_populate_record(null::public.tournament_match_events, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
    end loop;

    for r in select to_jsonb(snap.*) as j from public.tournament_state_snapshots snap where snap.tournament_id = v_tournament_id order by snap.created_at loop
        v_sql := v_sql || format('insert into public.tournament_state_snapshots select * from jsonb_populate_record(null::public.tournament_state_snapshots, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
    end loop;

    v_sql := v_sql || chr(10) || 'commit;' || chr(10);

    return v_sql;
end;
$$;

-- ============================================================
-- 4. Recreation minimale structure tournoi — cote base uniquement
-- ============================================================
drop function if exists public.tbk_rpc_recreate_tournament_minimal_structure(text, text);

create or replace function public.tbk_rpc_recreate_tournament_minimal_structure(
    p_season_label text,
    p_tournament_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_season_id uuid;
    v_tournament_id uuid;
    v_counts jsonb;
begin
    insert into public.club_seasons(label, active)
    values (p_season_label, true)
    on conflict (label)
    do update set active = true, updated_at = now()
    returning id into v_season_id;

    if v_season_id is null then
        select id into v_season_id from public.club_seasons where label = p_season_label limit 1;
    end if;

    insert into public.tournaments(season_id, name, active)
    values (v_season_id, p_tournament_name, true)
    on conflict (season_id, name)
    do update set active = true, updated_at = now()
    returning id into v_tournament_id;

    if v_tournament_id is null then
        select id into v_tournament_id from public.tournaments where season_id = v_season_id and name = p_tournament_name limit 1;
    end if;

    insert into public.tournament_competitions(tournament_id, competition_key, name, prefix, team_count, pools_frozen, sort_order, active)
    values
        (v_tournament_id, 'dm', 'Double Mixte', 'DM', 32, false, 10, true),
        (v_tournament_id, 'dh', 'Double Homme', 'DH', 16, false, 20, true)
    on conflict (tournament_id, competition_key)
    do update set name = excluded.name, prefix = excluded.prefix, team_count = excluded.team_count, active = true, updated_at = now();

    -- Poules DM
    insert into public.tournament_pools(competition_id, pool_key, sort_order)
    select c.id, x.pool_key, x.sort_order
    from public.tournament_competitions c
    cross join (values ('A',10),('B',20),('C',30),('D',40),('E',50),('F',60),('G',70),('H',80)) x(pool_key, sort_order)
    where c.tournament_id = v_tournament_id and c.competition_key = 'dm'
    on conflict (competition_id, pool_key)
    do update set sort_order = excluded.sort_order, updated_at = now();

    -- Poules DH
    insert into public.tournament_pools(competition_id, pool_key, sort_order)
    select c.id, x.pool_key, x.sort_order
    from public.tournament_competitions c
    cross join (values ('A',10),('B',20),('C',30),('D',40)) x(pool_key, sort_order)
    where c.tournament_id = v_tournament_id and c.competition_key = 'dh'
    on conflict (competition_id, pool_key)
    do update set sort_order = excluded.sort_order, updated_at = now();

    -- Equipes DM
    insert into public.tournament_teams(competition_id, pool_id, team_number, team_code, pool_rank, active)
    select c.id, p.id, n, 'DM-' || lpad(n::text, 2, '0'), ((n - 1) % 4) + 1, true
    from generate_series(1,32) n
    join public.tournament_competitions c on c.tournament_id = v_tournament_id and c.competition_key = 'dm'
    join public.tournament_pools p on p.competition_id = c.id and p.pool_key = chr(65 + ((n - 1) / 4))
    on conflict (competition_id, team_number)
    do update set pool_id = excluded.pool_id, team_code = excluded.team_code, pool_rank = excluded.pool_rank, active = true, updated_at = now();

    -- Equipes DH
    insert into public.tournament_teams(competition_id, pool_id, team_number, team_code, pool_rank, active)
    select c.id, p.id, n, 'DH-' || lpad(n::text, 2, '0'), ((n - 1) % 4) + 1, true
    from generate_series(1,16) n
    join public.tournament_competitions c on c.tournament_id = v_tournament_id and c.competition_key = 'dh'
    join public.tournament_pools p on p.competition_id = c.id and p.pool_key = chr(65 + ((n - 1) / 4))
    on conflict (competition_id, team_number)
    do update set pool_id = excluded.pool_id, team_code = excluded.team_code, pool_rank = excluded.pool_rank, active = true, updated_at = now();

    -- Deux lignes joueurs vides par equipe, sans ecraser les valeurs existantes
    insert into public.tournament_team_players(team_id, player_order, player_name, club_name)
    select tm.id, x.player_order, '', ''
    from public.tournament_teams tm
    join public.tournament_competitions c on c.id = tm.competition_id
    cross join (values (1),(2)) x(player_order)
    where c.tournament_id = v_tournament_id
    on conflict (team_id, player_order)
    do nothing;

    -- Checkins manquants uniquement
    insert into public.tournament_checkins(id, team_player_id, present, absent, paid, created_at, updated_at)
    select gen_random_uuid(), tp.id, false, true, false, now(), now()
    from public.tournament_team_players tp
    join public.tournament_teams tm on tm.id = tp.team_id
    join public.tournament_competitions c on c.id = tm.competition_id
    where c.tournament_id = v_tournament_id
    on conflict (team_player_id)
    do nothing;

    -- Terrains
    insert into public.tournament_courts(tournament_id, court_number, label, active)
    select v_tournament_id, n, 'Terrain ' || n::text, true
    from generate_series(1,9) n
    on conflict (tournament_id, court_number)
    do update set label = excluded.label, active = true, updated_at = now();

    select jsonb_build_object(
        'tournament_id', v_tournament_id,
        'competitions', (select count(*) from public.tournament_competitions where tournament_id = v_tournament_id),
        'teams', (select count(*) from public.tournament_teams tm join public.tournament_competitions c on c.id = tm.competition_id where c.tournament_id = v_tournament_id),
        'players', (select count(*) from public.tournament_team_players tp join public.tournament_teams tm on tm.id = tp.team_id join public.tournament_competitions c on c.id = tm.competition_id where c.tournament_id = v_tournament_id),
        'checkins', (select count(*) from public.tournament_checkins ch join public.tournament_team_players tp on tp.id = ch.team_player_id join public.tournament_teams tm on tm.id = tp.team_id join public.tournament_competitions c on c.id = tm.competition_id where c.tournament_id = v_tournament_id),
        'courts', (select count(*) from public.tournament_courts where tournament_id = v_tournament_id)
    ) into v_counts;

    return v_counts;
end;
$$;

-- ============================================================
-- 5. Reset complet RPC : export + suppression + recreation + audit
-- ============================================================
drop function if exists public.tbk_rpc_reset_tournament_full(text, text, text, text);

create or replace function public.tbk_rpc_reset_tournament_full(
    p_season_label text,
    p_tournament_name text,
    p_confirm text,
    p_site_login text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tournament_id uuid;
    v_export_sql text;
    v_recreate jsonb;
    v_deleted jsonb;
begin
    if coalesce(p_confirm, '') <> 'RESET TOURNOI' then
        raise exception 'Confirmation invalide. Saisir exactement RESET TOURNOI.';
    end if;

    -- Verrou anti-execution concurrente
    insert into public.app_locks(lock_key, status, locked_by, locked_at, expires_at, details)
    values ('tournament_reset', 'active', coalesce(p_site_login, 'unknown'), now(), now() + interval '5 minutes', jsonb_build_object('season', p_season_label, 'tournament', p_tournament_name))
    on conflict (lock_key)
    do update set status = 'active', locked_by = excluded.locked_by, locked_at = now(), expires_at = now() + interval '5 minutes', details = excluded.details, updated_at = now();

    select t.id into v_tournament_id
    from public.tournaments t
    join public.club_seasons s on s.id = t.season_id
    where s.label = p_season_label and t.name = p_tournament_name
    limit 1;

    if v_tournament_id is not null then
        v_export_sql := public.tbk_rpc_export_tournament_sql(p_season_label, p_tournament_name);

        select jsonb_build_object(
            'events', (select count(*) from public.tournament_match_events ev join public.tournament_matches m on m.id = ev.match_id join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = v_tournament_id),
            'assignments', (select count(*) from public.tournament_court_assignments ca join public.tournament_matches m on m.id = ca.match_id join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = v_tournament_id),
            'sets', (select count(*) from public.tournament_match_sets ms join public.tournament_matches m on m.id = ms.match_id join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = v_tournament_id),
            'matches', (select count(*) from public.tournament_matches m join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = v_tournament_id),
            'checkins', (select count(*) from public.tournament_checkins ch join public.tournament_team_players tp on tp.id = ch.team_player_id join public.tournament_teams tm on tm.id = tp.team_id join public.tournament_competitions c on c.id = tm.competition_id where c.tournament_id = v_tournament_id),
            'players', (select count(*) from public.tournament_team_players tp join public.tournament_teams tm on tm.id = tp.team_id join public.tournament_competitions c on c.id = tm.competition_id where c.tournament_id = v_tournament_id),
            'teams', (select count(*) from public.tournament_teams tm join public.tournament_competitions c on c.id = tm.competition_id where c.tournament_id = v_tournament_id),
            'pools', (select count(*) from public.tournament_pools p join public.tournament_competitions c on c.id = p.competition_id where c.tournament_id = v_tournament_id),
            'courts', (select count(*) from public.tournament_courts where tournament_id = v_tournament_id),
            'competitions', (select count(*) from public.tournament_competitions where tournament_id = v_tournament_id)
        ) into v_deleted;

        delete from public.tournament_match_events where match_id in (select m.id from public.tournament_matches m join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = v_tournament_id);
        delete from public.tournament_court_assignments where match_id in (select m.id from public.tournament_matches m join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = v_tournament_id);
        delete from public.tournament_match_sets where match_id in (select m.id from public.tournament_matches m join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = v_tournament_id);
        delete from public.tournament_matches where competition_id in (select id from public.tournament_competitions where tournament_id = v_tournament_id);
        delete from public.tournament_checkins where team_player_id in (select tp.id from public.tournament_team_players tp join public.tournament_teams tm on tm.id = tp.team_id join public.tournament_competitions c on c.id = tm.competition_id where c.tournament_id = v_tournament_id);
        delete from public.tournament_team_players where team_id in (select tm.id from public.tournament_teams tm join public.tournament_competitions c on c.id = tm.competition_id where c.tournament_id = v_tournament_id);
        delete from public.tournament_teams where competition_id in (select id from public.tournament_competitions where tournament_id = v_tournament_id);
        delete from public.tournament_pools where competition_id in (select id from public.tournament_competitions where tournament_id = v_tournament_id);
        delete from public.tournament_courts where tournament_id = v_tournament_id;
        delete from public.tournament_state_snapshots where tournament_id = v_tournament_id;
        delete from public.tournament_competitions where tournament_id = v_tournament_id;
        delete from public.tournaments where id = v_tournament_id;
    else
        v_export_sql := '-- Aucun tournoi existant a exporter pour ' || p_season_label || ' / ' || p_tournament_name || chr(10);
        v_deleted := '{}'::jsonb;
    end if;

    v_recreate := public.tbk_rpc_recreate_tournament_minimal_structure(p_season_label, p_tournament_name);

    update public.app_locks set status = 'done', expires_at = now(), updated_at = now() where lock_key = 'tournament_reset';

    perform public.tbk_try_audit(
        'tournament_reset_full_rpc',
        'tournaments',
        null,
        jsonb_build_object('season', p_season_label, 'tournament', p_tournament_name, 'deleted', v_deleted, 'recreated', v_recreate, 'site_login', p_site_login)
    );

    return jsonb_build_object(
        'status', 'ok',
        'season', p_season_label,
        'tournament', p_tournament_name,
        'export_sql', v_export_sql,
        'deleted_counts', v_deleted,
        'recreated_counts', v_recreate,
        'reset_at', now()
    );
exception when others then
    update public.app_locks set status = 'error', details = jsonb_build_object('error', sqlerrm), expires_at = now(), updated_at = now() where lock_key = 'tournament_reset';
    raise;
end;
$$;

grant execute on function public.tbk_rpc_export_tournament_sql(text, text) to authenticated;
grant execute on function public.tbk_rpc_recreate_tournament_minimal_structure(text, text) to authenticated;
grant execute on function public.tbk_rpc_reset_tournament_full(text, text, text, text) to authenticated;
grant execute on function public.tbk_try_audit(text, text, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
