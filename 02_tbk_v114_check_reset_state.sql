-- ============================================================
-- TBK V114 - Controle apres reset
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

SELECT key, value, updated_at
FROM public.tbk_tournament_runtime_flags
WHERE key IN ('reset_in_progress', 'auto_generation_locked', 'last_reset_at')
ORDER BY key;
