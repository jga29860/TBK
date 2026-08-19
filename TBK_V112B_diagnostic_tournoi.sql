-- ============================================================
-- TBK V112B - Diagnostic relationnel du périmètre Tournoi
-- Lecture seule, aucune modification.
-- ============================================================

-- 1. Structure générale
select
  c.competition_key,
  c.name,
  count(distinct tm.id) as nb_equipes,
  count(distinct p.id) as nb_participants,
  count(distinct ch.id) as nb_emargements,
  count(distinct m.id) as nb_matchs,
  count(distinct ms.id) as nb_sets
from public.tournament_competitions c
join public.tournaments t on t.id = c.tournament_id
join public.club_seasons s on s.id = t.season_id
left join public.tournament_teams tm on tm.competition_id = c.id
left join public.tournament_team_players p on p.team_id = tm.id
left join public.tournament_checkins ch on ch.team_player_id = p.id
left join public.tournament_matches m on m.competition_id = c.id
left join public.tournament_match_sets ms on ms.match_id = m.id
where s.label = '2026-2027'
  and t.name = 'Tournoi TBK 2026-2027'
group by c.competition_key, c.name
order by c.competition_key;

-- 2. Participants sans émargement
select
  c.competition_key,
  tm.team_code,
  tm.team_number,
  p.player_order,
  p.player_name,
  p.club_name
from public.tournament_team_players p
join public.tournament_teams tm on tm.id = p.team_id
join public.tournament_competitions c on c.id = tm.competition_id
join public.tournaments t on t.id = c.tournament_id
join public.club_seasons s on s.id = t.season_id
left join public.tournament_checkins ch on ch.team_player_id = p.id
where s.label = '2026-2027'
  and t.name = 'Tournoi TBK 2026-2027'
  and ch.id is null
order by c.competition_key, tm.team_number, p.player_order;

-- 3. Equipes sans compétition valide
select tm.*
from public.tournament_teams tm
left join public.tournament_competitions c on c.id = tm.competition_id
where c.id is null;

-- 4. Matchs sans 3 sets
select
  c.competition_key,
  m.match_number,
  m.phase,
  m.bracket,
  count(ms.id) as nb_sets
from public.tournament_matches m
join public.tournament_competitions c on c.id = m.competition_id
left join public.tournament_match_sets ms on ms.match_id = m.id
group by c.competition_key, m.id, m.match_number, m.phase, m.bracket
having count(ms.id) <> 3
order by c.competition_key, m.match_number;

-- 5. Dernières modifications émargement / participants
select
  c.competition_key,
  tm.team_code,
  p.player_order,
  p.player_name,
  p.club_name,
  p.updated_at as player_updated_at,
  ch.present,
  ch.absent,
  ch.paid,
  ch.updated_at as checkin_updated_at
from public.tournament_team_players p
join public.tournament_teams tm on tm.id = p.team_id
join public.tournament_competitions c on c.id = tm.competition_id
left join public.tournament_checkins ch on ch.team_player_id = p.id
order by greatest(coalesce(p.updated_at, '1970-01-01'::timestamptz), coalesce(ch.updated_at, '1970-01-01'::timestamptz)) desc
limit 30;
