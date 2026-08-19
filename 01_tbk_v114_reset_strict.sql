-- ============================================================
-- TBK V114 - Reset strict tournoi conseille
-- Date : 2026-08-19
-- Objet : reset complet, aucun match ni score apres reset,
--         verrou anti-generation automatique en base.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Flags runtime pour verrouiller certains comportements applicatifs.
CREATE TABLE IF NOT EXISTS public.tbk_tournament_runtime_flags (
    key text PRIMARY KEY,
    value jsonb NOT NULL DEFAULT 'null'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tbk_tournament_runtime_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tbk_runtime_flags_read ON public.tbk_tournament_runtime_flags;
CREATE POLICY tbk_runtime_flags_read
ON public.tbk_tournament_runtime_flags
FOR SELECT
TO authenticated, anon
USING (true);

DROP POLICY IF EXISTS tbk_runtime_flags_write ON public.tbk_tournament_runtime_flags;
CREATE POLICY tbk_runtime_flags_write
ON public.tbk_tournament_runtime_flags
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.tbk_set_runtime_flag(
    p_key text,
    p_value jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.tbk_tournament_runtime_flags(key, value, updated_at)
    VALUES (p_key, p_value, now())
    ON CONFLICT (key)
    DO UPDATE SET value = excluded.value, updated_at = now();

    RETURN jsonb_build_object(
        'success', true,
        'key', p_key,
        'value', p_value
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tbk_set_runtime_flag(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tbk_set_runtime_flag(text, jsonb) TO anon;

CREATE OR REPLACE FUNCTION public.tbk_rpc_reset_tournament_full_v114()
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
    v_deleted_events integer := 0;
    v_deleted_competitions integer := 0;
BEGIN
    PERFORM public.tbk_set_runtime_flag('reset_in_progress', 'true'::jsonb);
    PERFORM public.tbk_set_runtime_flag('auto_generation_locked', 'true'::jsonb);

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

    IF to_regclass('public.tournament_competitions') IS NOT NULL THEN
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
    END IF;

    PERFORM public.tbk_set_runtime_flag('reset_in_progress', 'false'::jsonb);
    PERFORM public.tbk_set_runtime_flag('auto_generation_locked', 'true'::jsonb);
    PERFORM public.tbk_set_runtime_flag('last_reset_at', to_jsonb(now()));

    RETURN jsonb_build_object(
        'success', true,
        'version', 'TBK V114',
        'message', 'Reset complet effectue. Auto-generation verrouillee.',
        'competition_created', v_new_competition_id IS NOT NULL,
        'competition_id', v_new_competition_id,
        'auto_generation_locked', true,
        'state_after_reset', jsonb_build_object(
            'competition_status', 'setup',
            'teams', 0,
            'players', 0,
            'checkins', 0,
            'groups', 0,
            'matches', 0,
            'scores', 0,
            'schedule', 0,
            'brackets', 0
        ),
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
        )
    );

EXCEPTION
    WHEN OTHERS THEN
        PERFORM public.tbk_set_runtime_flag('reset_in_progress', 'false'::jsonb);
        RETURN jsonb_build_object(
            'success', false,
            'version', 'TBK V114',
            'message', 'Erreur pendant le reset complet tournoi',
            'error', SQLERRM
        );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tbk_rpc_reset_tournament_full_v114() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tbk_rpc_reset_tournament_full_v114() TO anon;
