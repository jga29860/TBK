-- ============================================================
-- TBK V113 - Reset Tournoi complet cote RPC
-- Objectif :
--  1. Exporter toutes les donnees tournoi au format SQL
--  2. Supprimer toutes les donnees relatives au tournoi, y compris matchs et scores
--  3. Recreer la structure minimale de fonctionnement : tournoi, competitions DM/DH,
--     poules, equipes vides, joueurs vides, emargements vides, terrains
-- ============================================================

create extension if not exists pgcrypto;

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

create or replace function public.tbk_export_tournament_sql_v113(
  p_season_label text default '2026-2027',
  p_tournament_name text default 'Tournoi TBK 2026-2027'
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
  select t.id into v_tournament_id
  from public.tournaments t
  join public.club_seasons s on s.id = t.season_id
  where s.label = p_season_label
    and t.name = p_tournament_name
  limit 1;

  v_sql := v_sql || '-- ============================================================' || chr(10);
  v_sql := v_sql || '-- TBK - Export SQL tournoi avant reset complet' || chr(10);
  v_sql := v_sql || '-- Saison  : ' || coalesce(p_season_label, '') || chr(10);
  v_sql := v_sql || '-- Tournoi : ' || coalesce(p_tournament_name, '') || chr(10);
  v_sql := v_sql || '-- Genere  : ' || now()::text || chr(10);
  v_sql := v_sql || '-- ============================================================' || chr(10) || chr(10);
  v_sql := v_sql || 'begin;' || chr(10) || chr(10);

  if v_tournament_id is null then
    v_sql := v_sql || '-- Aucun tournoi trouve. Rien a restaurer.' || chr(10);
    v_sql := v_sql || 'commit;' || chr(10);
    return v_sql;
  end if;

  v_sql := v_sql || '-- Nettoyage cible avant restauration' || chr(10);
  v_sql := v_sql || format('delete from public.tournament_match_events where match_id in (select m.id from public.tournament_matches m join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = %L);%s', v_tournament_id, chr(10));
  v_sql := v_sql || format('delete from public.tournament_court_assignments where match_id in (select m.id from public.tournament_matches m join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = %L);%s', v_tournament_id, chr(10));
  v_sql := v_sql || format('delete from public.tournament_match_sets where match_id in (select m.id from public.tournament_matches m join public.tournament_competitions c on c.id = m.competition_id where c.tournament_id = %L);%s', v_tournament_id, chr(10));
  v_sql := v_sql || format('delete from public.tournament_matches where competition_id in (select id from public.tournament_competitions where tournament_id = %L);%s', v_tournament_id, chr(10));
  v_sql := v_sql || format('delete from public.tournament_checkins where team_player_id in (select p.id from public.tournament_team_players p join public.tournament_teams tm on tm.id = p.team_id join public.tournament_competitions c on c.id = tm.competition_id where c.tournament_id = %L);%s', v_tournament_id, chr(10));
  v_sql := v_sql || format('delete from public.tournament_team_players where team_id in (select tm.id from public.tournament_teams tm join public.tournament_competitions c on c.id = tm.competition_id where c.tournament_id = %L);%s', v_tournament_id, chr(10));
  v_sql := v_sql || format('delete from public.tournament_teams where competition_id in (select id from public.tournament_competitions where tournament_id = %L);%s', v_tournament_id, chr(10));
  v_sql := v_sql || format('delete from public.tournament_pools where competition_id in (select id from public.tournament_competitions where tournament_id = %L);%s', v_tournament_id, chr(10));
  v_sql := v_sql || format('delete from public.tournament_courts where tournament_id = %L;%s', v_tournament_id, chr(10));
  v_sql := v_sql || format('delete from public.tournament_state_snapshots where tournament_id = %L;%s', v_tournament_id, chr(10));
  v_sql := v_sql || format('delete from public.tournament_competitions where tournament_id = %L;%s', v_tournament_id, chr(10));
  v_sql := v_sql || format('delete from public.tournaments where id = %L;%s%s', v_tournament_id, chr(10), chr(10));

  v_sql := v_sql || '-- Donnees exportees' || chr(10);

  for r in select to_jsonb(t.*) as j from public.tournaments t where t.id = v_tournament_id loop
    v_sql := v_sql || format('insert into public.tournaments select * from jsonb_populate_record(null::public.tournaments, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
  end loop;

  for r in select to_jsonb(x.*) as j from public.tournament_competitions x where x.tournament_id = v_tournament_id order by x.sort_order, x.competition_key loop
    v_sql := v_sql || format('insert into public.tournament_competitions select * from jsonb_populate_record(null::public.tournament_competitions, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
  end loop;

  for r in select to_jsonb(x.*) as j from public.tournament_pools x join public.tournament_competitions c on c.id=x.competition_id where c.tournament_id=v_tournament_id order by c.competition_key, x.sort_order loop
    v_sql := v_sql || format('insert into public.tournament_pools select * from jsonb_populate_record(null::public.tournament_pools, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
  end loop;

  for r in select to_jsonb(x.*) as j from public.tournament_courts x where x.tournament_id=v_tournament_id order by x.court_number loop
    v_sql := v_sql || format('insert into public.tournament_courts select * from jsonb_populate_record(null::public.tournament_courts, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
  end loop;

  for r in select to_jsonb(x.*) as j from public.tournament_teams x join public.tournament_competitions c on c.id=x.competition_id where c.tournament_id=v_tournament_id order by c.competition_key, x.team_number loop
    v_sql := v_sql || format('insert into public.tournament_teams select * from jsonb_populate_record(null::public.tournament_teams, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
  end loop;

  for r in select to_jsonb(x.*) as j from public.tournament_team_players x join public.tournament_teams tm on tm.id=x.team_id join public.tournament_competitions c on c.id=tm.competition_id where c.tournament_id=v_tournament_id order by c.competition_key, tm.team_number, x.player_order loop
    v_sql := v_sql || format('insert into public.tournament_team_players select * from jsonb_populate_record(null::public.tournament_team_players, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
  end loop;

  for r in select to_jsonb(x.*) as j from public.tournament_checkins x join public.tournament_team_players p on p.id=x.team_player_id join public.tournament_teams tm on tm.id=p.team_id join public.tournament_competitions c on c.id=tm.competition_id where c.tournament_id=v_tournament_id order by c.competition_key, tm.team_number, p.player_order loop
    v_sql := v_sql || format('insert into public.tournament_checkins select * from jsonb_populate_record(null::public.tournament_checkins, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
  end loop;

  for r in select to_jsonb(x.*) as j from public.tournament_matches x join public.tournament_competitions c on c.id=x.competition_id where c.tournament_id=v_tournament_id order by c.competition_key, x.match_number loop
    v_sql := v_sql || format('insert into public.tournament_matches select * from jsonb_populate_record(null::public.tournament_matches, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
  end loop;

  for r in select to_jsonb(x.*) as j from public.tournament_match_sets x join public.tournament_matches m on m.id=x.match_id join public.tournament_competitions c on c.id=m.competition_id where c.tournament_id=v_tournament_id order by c.competition_key, m.match_number, x.set_number loop
    v_sql := v_sql || format('insert into public.tournament_match_sets select * from jsonb_populate_record(null::public.tournament_match_sets, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
  end loop;

  for r in select to_jsonb(x.*) as j from public.tournament_court_assignments x join public.tournament_matches m on m.id=x.match_id join public.tournament_competitions c on c.id=m.competition_id where c.tournament_id=v_tournament_id order by x.assigned_at loop
    v_sql := v_sql || format('insert into public.tournament_court_assignments select * from jsonb_populate_record(null::public.tournament_court_assignments, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
  end loop;

  for r in select to_jsonb(x.*) as j from public.tournament_match_events x join public.tournament_matches m on m.id=x.match_id join public.tournament_competitions c on c.id=m.competition_id where c.tournament_id=v_tournament_id order by x.created_at loop
    v_sql := v_sql || format('insert into public.tournament_match_events select * from jsonb_populate_record(null::public.tournament_match_events, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
  end loop;

  for r in select to_jsonb(x.*) as j from public.tournament_state_snapshots x where x.tournament_id=v_tournament_id order by x.created_at loop
    v_sql := v_sql || format('insert into public.tournament_state_snapshots select * from jsonb_populate_record(null::public.tournament_state_snapshots, %L::jsonb) on conflict (id) do nothing;%s', r.j::text, chr(10));
  end loop;

  v_sql := v_sql || chr(10) || 'commit;' || chr(10);
  return v_sql;
end;
$$;

create or replace function public.tbk_rpc_reset_tournament_complete_v113(
  p_season_label text default '2026-2027',
  p_tournament_name text default 'Tournoi TBK 2026-2027',
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_export_sql text;
  v_season_id uuid;
  v_tournament_id uuid;
  v_dm_id uuid;
  v_dh_id uuid;
  v_deleted jsonb := '{}'::jsonb;
  v_count int;
begin
  insert into public.app_locks(lock_key, status, locked_by, locked_at, expires_at, details)
  values ('tournament_reset', 'active', p_actor, now(), now() + interval '5 minutes', jsonb_build_object('season', p_season_label, 'tournament', p_tournament_name))
  on conflict(lock_key) do update set status='active', locked_by=excluded.locked_by, locked_at=now(), expires_at=excluded.expires_at, details=excluded.details, updated_at=now();

  v_export_sql := public.tbk_export_tournament_sql_v113(p_season_label, p_tournament_name);

  select t.id into v_tournament_id
  from public.tournaments t
  join public.club_seasons s on s.id=t.season_id
  where s.label=p_season_label and t.name=p_tournament_name
  limit 1;

  if v_tournament_id is not null then
    delete from public.tournament_match_events where match_id in (select m.id from public.tournament_matches m join public.tournament_competitions c on c.id=m.competition_id where c.tournament_id=v_tournament_id); get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('match_events', v_count);
    delete from public.tournament_court_assignments where match_id in (select m.id from public.tournament_matches m join public.tournament_competitions c on c.id=m.competition_id where c.tournament_id=v_tournament_id); get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('court_assignments', v_count);
    delete from public.tournament_match_sets where match_id in (select m.id from public.tournament_matches m join public.tournament_competitions c on c.id=m.competition_id where c.tournament_id=v_tournament_id); get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('match_sets', v_count);
    delete from public.tournament_matches where competition_id in (select id from public.tournament_competitions where tournament_id=v_tournament_id); get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('matches', v_count);
    delete from public.tournament_checkins where team_player_id in (select p.id from public.tournament_team_players p join public.tournament_teams tm on tm.id=p.team_id join public.tournament_competitions c on c.id=tm.competition_id where c.tournament_id=v_tournament_id); get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('checkins', v_count);
    delete from public.tournament_team_players where team_id in (select tm.id from public.tournament_teams tm join public.tournament_competitions c on c.id=tm.competition_id where c.tournament_id=v_tournament_id); get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('team_players', v_count);
    delete from public.tournament_teams where competition_id in (select id from public.tournament_competitions where tournament_id=v_tournament_id); get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('teams', v_count);
    delete from public.tournament_pools where competition_id in (select id from public.tournament_competitions where tournament_id=v_tournament_id); get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('pools', v_count);
    delete from public.tournament_courts where tournament_id=v_tournament_id; get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('courts', v_count);
    delete from public.tournament_state_snapshots where tournament_id=v_tournament_id; get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('state_snapshots', v_count);
    delete from public.tournament_competitions where tournament_id=v_tournament_id; get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('competitions', v_count);
    delete from public.tournaments where id=v_tournament_id; get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('tournaments', v_count);
  end if;

  insert into public.club_seasons(label, active)
  values (p_season_label, true)
  on conflict(label) do update set active=true, updated_at=now()
  returning id into v_season_id;

  if v_season_id is null then
    select id into v_season_id from public.club_seasons where label=p_season_label limit 1;
  end if;

  insert into public.tournaments(season_id, name, active)
  values (v_season_id, p_tournament_name, true)
  on conflict(season_id, name) do update set active=true, updated_at=now()
  returning id into v_tournament_id;

  insert into public.tournament_competitions(tournament_id, competition_key, name, prefix, team_count, pools_frozen, sort_order, active)
  values
    (v_tournament_id, 'dm', 'Double Mixte', 'DM', 32, false, 10, true),
    (v_tournament_id, 'dh', 'Double Homme', 'DH', 16, false, 20, true)
  on conflict(tournament_id, competition_key) do update set active=true, updated_at=now();

  select id into v_dm_id from public.tournament_competitions where tournament_id=v_tournament_id and competition_key='dm';
  select id into v_dh_id from public.tournament_competitions where tournament_id=v_tournament_id and competition_key='dh';

  insert into public.tournament_pools(competition_id, pool_key, sort_order)
  select v_dm_id, pool_key, sort_order
  from (values ('A',10),('B',20),('C',30),('D',40),('E',50),('F',60),('G',70),('H',80)) as p(pool_key, sort_order)
  on conflict(competition_id, pool_key) do update set sort_order=excluded.sort_order, updated_at=now();

  insert into public.tournament_pools(competition_id, pool_key, sort_order)
  select v_dh_id, pool_key, sort_order
  from (values ('A',10),('B',20),('C',30),('D',40)) as p(pool_key, sort_order)
  on conflict(competition_id, pool_key) do update set sort_order=excluded.sort_order, updated_at=now();

  insert into public.tournament_teams(competition_id, pool_id, team_number, team_code, pool_rank, active)
  select v_dm_id, p.id, n, 'DM-' || lpad(n::text,2,'0'), ((n-1)%4)+1, true
  from generate_series(1,32) n
  join public.tournament_pools p on p.competition_id=v_dm_id and p.pool_key=chr(65 + ((n - 1) / 4));

  insert into public.tournament_teams(competition_id, pool_id, team_number, team_code, pool_rank, active)
  select v_dh_id, p.id, n, 'DH-' || lpad(n::text,2,'0'), ((n-1)%4)+1, true
  from generate_series(1,16) n
  join public.tournament_pools p on p.competition_id=v_dh_id and p.pool_key=chr(65 + ((n - 1) / 4));

  insert into public.tournament_team_players(team_id, player_order, player_name, club_name)
  select tm.id, x.player_order, '', ''
  from public.tournament_teams tm
  cross join (values (1),(2)) as x(player_order)
  where tm.competition_id in (v_dm_id, v_dh_id);

  insert into public.tournament_checkins(id, team_player_id, present, absent, paid, created_at, updated_at)
  select gen_random_uuid(), p.id, false, true, false, now(), now()
  from public.tournament_team_players p
  join public.tournament_teams tm on tm.id=p.team_id
  where tm.competition_id in (v_dm_id, v_dh_id);

  insert into public.tournament_courts(tournament_id, court_number, label, active)
  select v_tournament_id, n, 'Terrain ' || n::text, true
  from generate_series(1,9) n;

  update public.app_locks set status='done', updated_at=now(), details=details || jsonb_build_object('done_at', now()) where lock_key='tournament_reset';

  return jsonb_build_object(
    'success', true,
    'message', 'Tournoi reinitialise completement et structure minimale recreee',
    'season_label', p_season_label,
    'tournament_name', p_tournament_name,
    'tournament_id', v_tournament_id,
    'export_sql', v_export_sql,
    'deleted', v_deleted,
    'recreated', jsonb_build_object('competitions', 2, 'dm_teams', 32, 'dh_teams', 16, 'players', 96, 'checkins', 96, 'courts', 9, 'matches', 0, 'scores', 0)
  );
exception when others then
  update public.app_locks set status='error', updated_at=now(), details=details || jsonb_build_object('error', sqlerrm, 'error_at', now()) where lock_key='tournament_reset';
  raise;
end;
$$;

-- Compatibilite avec l'ancien nom RPC V110
create or replace function public.tbk_rpc_reset_tournament_full(
  p_season_label text default '2026-2027',
  p_tournament_name text default 'Tournoi TBK 2026-2027',
  p_actor text default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.tbk_rpc_reset_tournament_complete_v113(p_season_label, p_tournament_name, p_actor);
$$;

grant execute on function public.tbk_export_tournament_sql_v113(text, text) to authenticated;
grant execute on function public.tbk_rpc_reset_tournament_complete_v113(text, text, text) to authenticated;
grant execute on function public.tbk_rpc_reset_tournament_full(text, text, text) to authenticated;

notify pgrst, 'reload schema';
