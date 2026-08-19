-- ============================================================
-- TBK V76.1 - Reset tournoi strict
-- Date : 2026-08-19
-- Objet :
--   - Reinitialisation complete du tournoi
--   - Suppression de tous les matchs et scores
--   - Recreation d'une competition vide en statut setup
--   - Aucun score renseigne au demarrage
--   - Aucune generation automatique apres reset
-- ============================================================

CREATE OR REPLACE FUNCTION public.reset_tournament_complete()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_new_competition_id uuid;

    v_deleted_scores integer := 0;
    v_deleted_matches integer := 0;
    v_deleted_schedule integer := 0;
    v_deleted_groups integer := 0;
    v_deleted_brackets integer := 0;
    v_deleted_checkins integer := 0;
    v_deleted_teams integer := 0;
    v_deleted_players integer := 0;
    v_deleted_competitions integer := 0;
    v_deleted_events integer := 0;
BEGIN
    IF to_regclass('public.tournament_scores') IS NOT NULL THEN
        DELETE FROM public.tournament_scores;
        GET DIAGNOSTICS v_deleted_scores = ROW_COUNT;
    END IF;

    IF to_regclass('public.tournament_matches') IS NOT NULL THEN
        DELETE FROM public.tournament_matches;
        GET DIAGNOSTICS v_deleted_matches = ROW_COUNT;
    END IF;

    IF to_regclass('public.tournament_schedule') IS NOT NULL THEN
        DELETE FROM public.tournament_schedule;
        GET DIAGNOSTICS v_deleted_schedule = ROW_COUNT;
    END IF;

    IF to_regclass('public.tournament_groups') IS NOT NULL THEN
        DELETE FROM public.tournament_groups;
        GET DIAGNOSTICS v_deleted_groups = ROW_COUNT;
    END IF;

    IF to_regclass('public.tournament_brackets') IS NOT NULL THEN
        DELETE FROM public.tournament_brackets;
        GET DIAGNOSTICS v_deleted_brackets = ROW_COUNT;
    END IF;

    IF to_regclass('public.tournament_checkins') IS NOT NULL THEN
        DELETE FROM public.tournament_checkins;
        GET DIAGNOSTICS v_deleted_checkins = ROW_COUNT;
    END IF;

    IF to_regclass('public.tournament_teams') IS NOT NULL THEN
        DELETE FROM public.tournament_teams;
        GET DIAGNOSTICS v_deleted_teams = ROW_COUNT;
    END IF;

    IF to_regclass('public.tournament_players') IS NOT NULL THEN
        DELETE FROM public.tournament_players;
        GET DIAGNOSTICS v_deleted_players = ROW_COUNT;
    END IF;

    IF to_regclass('public.tournament_events') IS NOT NULL THEN
        DELETE FROM public.tournament_events;
        GET DIAGNOSTICS v_deleted_events = ROW_COUNT;
    END IF;

    IF to_regclass('public.tournament_competitions') IS NOT NULL THEN
        DELETE FROM public.tournament_competitions;
        GET DIAGNOSTICS v_deleted_competitions = ROW_COUNT;
    END IF;

    INSERT INTO public.tournament_competitions (
        id,
        name,
        status,
        created_at,
        updated_at
    )
    VALUES (
        gen_random_uuid(),
        'Tournoi TBK',
        'setup',
        now(),
        now()
    )
    RETURNING id INTO v_new_competition_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Tournoi reinitialise completement sans regeneration automatique',
        'competition_created', true,
        'competition_id', v_new_competition_id,
        'auto_generation_disabled', true,
        'deleted', jsonb_build_object(
            'scores', v_deleted_scores,
            'matches', v_deleted_matches,
            'schedule', v_deleted_schedule,
            'groups', v_deleted_groups,
            'brackets', v_deleted_brackets,
            'checkins', v_deleted_checkins,
            'teams', v_deleted_teams,
            'players', v_deleted_players,
            'events', v_deleted_events,
            'competitions', v_deleted_competitions
        ),
        'state_after_reset', jsonb_build_object(
            'competition_status', 'setup',
            'teams', 0,
            'players', 0,
            'matches', 0,
            'scores', 0,
            'groups', 0,
            'schedule', 0,
            'brackets', 0
        )
    );

EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Erreur pendant la reinitialisation complete du tournoi',
            'error', SQLERRM
        );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_tournament_complete() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_tournament_complete() TO anon;
