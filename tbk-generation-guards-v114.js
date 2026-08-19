// ============================================================
// TBK V114 - Gardes anti-generation automatique
// ============================================================

window.TBK_TOURNAMENT_AUTO_GENERATION = false;
window.TBK_TOURNAMENT_RESET_IN_PROGRESS = false;
window.TBK_TOURNAMENT_JUST_RESET = false;
window.TBK_TOURNAMENT_AUTO_GENERATION_LOCKED = true;

async function tbkGetRuntimeFlag(key) {
  if (!window.supabase) return null;

  const { data, error } = await window.supabase
    .from("tbk_tournament_runtime_flags")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    console.warn("Lecture flag runtime impossible", key, error);
    return null;
  }

  return data ? data.value : null;
}

async function tbkSetRuntimeFlag(key, value) {
  if (!window.supabase) return null;

  const { data, error } = await window.supabase.rpc("tbk_set_runtime_flag", {
    p_key: key,
    p_value: value
  });

  if (error) {
    console.warn("Ecriture flag runtime impossible", key, error);
    return null;
  }

  return data;
}

async function tbkRefreshGenerationLockFromDatabase() {
  const locked = await tbkGetRuntimeFlag("auto_generation_locked");
  window.TBK_TOURNAMENT_AUTO_GENERATION_LOCKED = locked !== false;
  return window.TBK_TOURNAMENT_AUTO_GENERATION_LOCKED;
}

function tbkCanAutoGenerateTournamentData(context = {}) {
  const source = context.source || "unknown";
  const competition = window.tournamentCompetition || null;

  if (window.TBK_TOURNAMENT_AUTO_GENERATION !== true) {
    console.log("Generation automatique bloquee : mode global desactive", { source });
    return false;
  }

  if (window.TBK_TOURNAMENT_RESET_IN_PROGRESS === true) {
    console.log("Generation automatique bloquee : reset en cours", { source });
    return false;
  }

  if (window.TBK_TOURNAMENT_JUST_RESET === true) {
    console.log("Generation automatique bloquee : tournoi juste reinitialise", { source });
    return false;
  }

  if (window.TBK_TOURNAMENT_AUTO_GENERATION_LOCKED === true) {
    console.log("Generation automatique bloquee : verrou base/app actif", { source });
    return false;
  }

  if (!competition) {
    console.log("Generation automatique bloquee : aucune competition active", { source });
    return false;
  }

  if (competition.status === "setup") {
    console.log("Generation automatique bloquee : competition en mode setup", { source });
    return false;
  }

  return true;
}

function tbkMarkManualTournamentAction() {
  window.TBK_TOURNAMENT_JUST_RESET = false;
}

async function tbkRunTournamentAutoGeneration(context = {}) {
  const source = context.source || "unknown";
  await tbkRefreshGenerationLockFromDatabase();

  if (!tbkCanAutoGenerateTournamentData({ source })) {
    return;
  }

  if (typeof generateGroups === "function") {
    await generateGroups({ source: "auto", triggeredBy: source });
  }

  if (typeof generateMatches === "function") {
    await generateMatches({ source: "auto", triggeredBy: source });
  }

  if (typeof generateSchedule === "function") {
    await generateSchedule({ source: "auto", triggeredBy: source });
  }
}
