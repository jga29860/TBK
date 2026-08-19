-- ============================================================
-- TBK V76.1 - Controle apres reset tournoi
-- ============================================================

SELECT 'tournament_scores' AS table_name, COUNT(*) AS total FROM public.tournament_scores
UNION ALL
SELECT 'tournament_matches', COUNT(*) FROM public.tournament_matches
UNION ALL
SELECT 'tournament_schedule', COUNT(*) FROM public.tournament_schedule
UNION ALL
SELECT 'tournament_groups', COUNT(*) FROM public.tournament_groups
UNION ALL
SELECT 'tournament_brackets', COUNT(*) FROM public.tournament_brackets
UNION ALL
SELECT 'tournament_checkins', COUNT(*) FROM public.tournament_checkins
UNION ALL
SELECT 'tournament_teams', COUNT(*) FROM public.tournament_teams
UNION ALL
SELECT 'tournament_players', COUNT(*) FROM public.tournament_players
UNION ALL
SELECT 'tournament_events', COUNT(*) FROM public.tournament_events
UNION ALL
SELECT 'tournament_competitions', COUNT(*) FROM public.tournament_competitions;
