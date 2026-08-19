// ============================================================
// TBK V114 - Reset strict tournoi
// ============================================================

function tbkShowTournamentMessage(message, type = "info") {
  console.log(`[${type}] ${message}`);
  const zone = document.getElementById("tournament-message") || document.getElementById("tbk-message");

  if (!zone) {
    alert(message);
    return;
  }

  zone.textContent = message;
  zone.className = "tournament-message " + type;
  zone.style.display = "block";
}

function tbkPauseRealtimeAndAutosave() {
  window.TBK_REALTIME_PAUSED = true;
  window.TBK_AUTOSAVE_PAUSED = true;

  if (typeof pauseRealtime === "function") pauseRealtime();
  if (typeof pauseAutosave === "function") pauseAutosave();
}

function tbkResumeRealtimeAndAutosave() {
  window.TBK_REALTIME_PAUSED = false;
  window.TBK_AUTOSAVE_PAUSED = false;

  if (typeof resumeRealtime === "function") resumeRealtime();
  if (typeof resumeAutosave === "function") resumeAutosave();
}

function tbkClearLocalTournamentState() {
  window.tournamentCompetition = null;
  window.tournamentTeams = [];
  window.tournamentPlayers = [];
  window.tournamentCheckins = [];
  window.tournamentGroups = [];
  window.tournamentMatches = [];
  window.tournamentScores = [];
  window.tournamentSchedule = [];
  window.tournamentBrackets = [];
  window.tournamentEvents = [];

  [
    "tbk_tournament_competition",
    "tbk_tournament_teams",
    "tbk_tournament_players",
    "tbk_tournament_checkins",
    "tbk_tournament_groups",
    "tbk_tournament_matches",
    "tbk_tournament_scores",
    "tbk_tournament_schedule",
    "tbk_tournament_brackets",
    "tbk_tournament_events"
  ].forEach(function(key) {
    localStorage.removeItem(key);
  });
}

async function tbkLoadTournamentDataSafe(source = "manual") {
  if (typeof loadTournamentData === "function") {
    await loadTournamentData({ allowAutoGeneration: false, source });
    return;
  }

  if (typeof loadCompetition === "function") await loadCompetition();
  if (typeof loadTeams === "function") await loadTeams();
  if (typeof loadPlayers === "function") await loadPlayers();
  if (typeof loadCheckins === "function") await loadCheckins();
  if (typeof loadGroups === "function") await loadGroups();
  if (typeof loadMatches === "function") await loadMatches();
  if (typeof loadScores === "function") await loadScores();
  if (typeof loadSchedule === "function") await loadSchedule();
  if (typeof loadBrackets === "function") await loadBrackets();
}

function tbkRefreshTournamentScreensSafe(source = "manual") {
  if (typeof refreshTournamentScreens === "function") {
    refreshTournamentScreens({ allowAutoGeneration: false, source });
    return;
  }

  if (typeof renderCheckins === "function") renderCheckins();
  if (typeof renderTeams === "function") renderTeams();
  if (typeof renderGroups === "function") renderGroups();
  if (typeof renderMatches === "function") renderMatches();
  if (typeof renderScores === "function") renderScores();
  if (typeof renderSchedule === "function") renderSchedule();
  if (typeof renderBrackets === "function") renderBrackets();
  if (typeof updateTournamentDashboard === "function") updateTournamentDashboard();
}

async function tbkResetTournamentFullV114() {
  const confirmation = confirm(
    "Attention : cette action va supprimer toutes les donnees du tournoi :\n\n" +
    "- equipes\n" +
    "- joueurs\n" +
    "- emargements\n" +
    "- poules\n" +
    "- matchs\n" +
    "- scores\n" +
    "- planning\n" +
    "- phases finales\n\n" +
    "Aucune poule, aucun match et aucun score ne sera regenere automatiquement apres reset.\n\n" +
    "Confirmer la reinitialisation complete ?"
  );

  if (!confirmation) return;

  try {
    window.TBK_TOURNAMENT_RESET_IN_PROGRESS = true;
    window.TBK_TOURNAMENT_JUST_RESET = true;
    window.TBK_TOURNAMENT_AUTO_GENERATION_LOCKED = true;
    window.TBK_TOURNAMENT_AUTO_GENERATION = false;

    tbkPauseRealtimeAndAutosave();
    tbkShowTournamentMessage("Reset complet du tournoi en cours...", "info");

    if (typeof tbkSetRuntimeFlag === "function") {
      await tbkSetRuntimeFlag("reset_in_progress", true);
      await tbkSetRuntimeFlag("auto_generation_locked", true);
    }

    const { data, error } = await window.supabase.rpc("tbk_rpc_reset_tournament_full_v114");

    if (error) {
      console.error("Erreur RPC tbk_rpc_reset_tournament_full_v114", error);
      tbkShowTournamentMessage("Erreur pendant le reset : " + error.message, "error");
      return;
    }

    if (!data || data.success !== true) {
      console.error("Reponse RPC inattendue", data);
      tbkShowTournamentMessage("Le reset n'a pas pu etre confirme.", "error");
      return;
    }

    console.log("Reset TBK V114 OK", data);
    tbkClearLocalTournamentState();

    await tbkLoadTournamentDataSafe("reset_v114");
    tbkRefreshTournamentScreensSafe("reset_v114");

    tbkShowTournamentMessage(
      "Tournoi reinitialise. Aucun match, aucune poule et aucun score n'ont ete generes automatiquement.",
      "success"
    );
  } catch (err) {
    console.error("Exception tbkResetTournamentFullV114", err);
    tbkShowTournamentMessage("Erreur technique pendant le reset complet.", "error");
  } finally {
    window.TBK_TOURNAMENT_RESET_IN_PROGRESS = false;
    tbkResumeRealtimeAndAutosave();

    if (typeof tbkSetRuntimeFlag === "function") {
      await tbkSetRuntimeFlag("reset_in_progress", false);
      await tbkSetRuntimeFlag("auto_generation_locked", true);
    }
  }
}

async function tbkSaveMatchScoreV114(matchId, team1Score, team2Score) {
  if (!matchId) {
    tbkShowTournamentMessage("Impossible d'enregistrer le score : match introuvable.", "error");
    return;
  }

  if (team1Score === null || team1Score === undefined || team1Score === "") {
    tbkShowTournamentMessage("Le score de la premiere equipe doit etre renseigne.", "warning");
    return;
  }

  if (team2Score === null || team2Score === undefined || team2Score === "") {
    tbkShowTournamentMessage("Le score de la deuxieme equipe doit etre renseigne.", "warning");
    return;
  }

  const score1 = Number(team1Score);
  const score2 = Number(team2Score);

  if (Number.isNaN(score1) || Number.isNaN(score2)) {
    tbkShowTournamentMessage("Les scores doivent etre numeriques.", "warning");
    return;
  }

  const { data, error } = await window.supabase
    .from("tournament_scores")
    .upsert(
      {
        match_id: matchId,
        team1_score: score1,
        team2_score: score2,
        updated_at: new Date().toISOString()
      },
      { onConflict: "match_id" }
    )
    .select();

  if (error) {
    console.error("Erreur enregistrement score", error);
    tbkShowTournamentMessage("Erreur pendant l'enregistrement du score.", "error");
    return;
  }

  tbkShowTournamentMessage("Score enregistre.", "success");
  await tbkLoadTournamentDataSafe("score_saved");
  tbkRefreshTournamentScreensSafe("score_saved");
  return data;
}

function tbkGetScoreTextForMatch(matchId) {
  const scores = window.tournamentScores || [];
  const score = scores.find(function(item) {
    return item.match_id === matchId;
  });

  if (!score) return "Score non renseigne";
  return `${score.team1_score} - ${score.team2_score}`;
}
