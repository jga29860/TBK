// ============================================================
// TBK V76.1 - Reset tournoi strict sans generation automatique
// ============================================================

// Par defaut, aucune generation automatique ne doit se lancer.
// Les poules, matchs et planning doivent etre generes uniquement
// par action explicite de l'utilisateur.
const TOURNAMENT_AUTO_GENERATION = false;

// Flags temporaires actives pendant et juste apres un reset complet.
let TOURNAMENT_RESET_IN_PROGRESS = false;
let TOURNAMENT_JUST_RESET = false;

// ============================================================
// Controle central de generation automatique
// ============================================================
function canAutoGenerateTournamentData(context = {}) {
  const source = context.source || "unknown";

  if (TOURNAMENT_AUTO_GENERATION !== true) {
    console.log("Generation automatique bloquee : TOURNAMENT_AUTO_GENERATION = false", { source });
    return false;
  }

  if (TOURNAMENT_RESET_IN_PROGRESS === true) {
    console.log("Generation automatique bloquee : reset en cours", { source });
    return false;
  }

  if (TOURNAMENT_JUST_RESET === true) {
    console.log("Generation automatique bloquee : tournoi juste reinitialise", { source });
    return false;
  }

  const competition = window.tournamentCompetition;

  if (!competition) {
    console.log("Generation automatique bloquee : aucune competition active", { source });
    return false;
  }

  if (competition.status === "setup") {
    console.log("Generation automatique bloquee : competition en statut setup", { source });
    return false;
  }

  return true;
}

// ============================================================
// Reset complet strict du tournoi
// ============================================================
async function resetTournamentComplete() {
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
    "Apres cette action, aucune poule ni aucun match ne sera regenere automatiquement.\n" +
    "Le tournoi reviendra en mode preparation.\n\n" +
    "Confirmer la reinitialisation complete ?"
  );

  if (!confirmation) {
    return;
  }

  try {
    TOURNAMENT_RESET_IN_PROGRESS = true;
    TOURNAMENT_JUST_RESET = true;

    showTournamentMessage("Reinitialisation complete du tournoi en cours...", "info");

    const { data, error } = await supabase.rpc("reset_tournament_complete");

    if (error) {
      console.error("Erreur reset_tournament_complete :", error);
      showTournamentMessage("Erreur pendant la reinitialisation du tournoi : " + error.message, "error");
      return;
    }

    if (!data || data.success !== true) {
      console.error("Reponse RPC inattendue :", data);
      showTournamentMessage("La reinitialisation n'a pas pu etre confirmee.", "error");
      return;
    }

    console.log("Reset tournoi V76.1 OK :", data);

    clearLocalTournamentState();

    await loadTournamentData({
      allowAutoGeneration: false,
      source: "reset"
    });

    refreshTournamentScreens({
      allowAutoGeneration: false,
      source: "reset"
    });

    showTournamentMessage(
      "Tournoi reinitialise completement. Aucune poule, aucun match et aucun score n'ont ete generes automatiquement.",
      "success"
    );
  } catch (err) {
    console.error("Exception resetTournamentComplete :", err);
    showTournamentMessage("Erreur technique pendant la reinitialisation complete.", "error");
  } finally {
    TOURNAMENT_RESET_IN_PROGRESS = false;
  }
}

// ============================================================
// Nettoyage local apres reset
// ============================================================
function clearLocalTournamentState() {
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

  localStorage.removeItem("tbk_tournament_competition");
  localStorage.removeItem("tbk_tournament_teams");
  localStorage.removeItem("tbk_tournament_players");
  localStorage.removeItem("tbk_tournament_checkins");
  localStorage.removeItem("tbk_tournament_matches");
  localStorage.removeItem("tbk_tournament_scores");
  localStorage.removeItem("tbk_tournament_schedule");
  localStorage.removeItem("tbk_tournament_groups");
  localStorage.removeItem("tbk_tournament_brackets");
  localStorage.removeItem("tbk_tournament_events");
}

// ============================================================
// Chargement des donnees sans auto-generation par defaut
// ============================================================
async function loadTournamentData(options = {}) {
  const allowAutoGeneration = options.allowAutoGeneration === true;
  const source = options.source || "manual";

  try {
    console.log("Chargement donnees tournoi", { allowAutoGeneration, source });

    if (typeof loadCompetition === "function") await loadCompetition();
    if (typeof loadTeams === "function") await loadTeams();
    if (typeof loadPlayers === "function") await loadPlayers();
    if (typeof loadCheckins === "function") await loadCheckins();
    if (typeof loadGroups === "function") await loadGroups();
    if (typeof loadMatches === "function") await loadMatches();
    if (typeof loadScores === "function") await loadScores();
    if (typeof loadSchedule === "function") await loadSchedule();
    if (typeof loadBrackets === "function") await loadBrackets();

    if (allowAutoGeneration === true && canAutoGenerateTournamentData({ source })) {
      await runTournamentAutoGeneration({ source });
    } else {
      console.log("Aucune generation automatique lancee apres chargement", { allowAutoGeneration, source });
    }
  } catch (err) {
    console.error("Erreur loadTournamentData :", err);
    showTournamentMessage("Erreur pendant le chargement des donnees tournoi.", "error");
  }
}

// ============================================================
// Generation automatique controlee
// ============================================================
async function runTournamentAutoGeneration(context = {}) {
  const source = context.source || "unknown";

  if (!canAutoGenerateTournamentData({ source })) {
    return;
  }

  console.log("Generation automatique tournoi autorisee", { source });

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

// ============================================================
// Refresh ecrans sans generation automatique
// ============================================================
function refreshTournamentScreens(options = {}) {
  const allowAutoGeneration = options.allowAutoGeneration === true;
  const source = options.source || "manual";

  console.log("Refresh ecrans tournoi", { allowAutoGeneration, source });

  if (typeof renderCheckins === "function") renderCheckins();
  if (typeof renderTeams === "function") renderTeams();
  if (typeof renderGroups === "function") renderGroups();
  if (typeof renderMatches === "function") renderMatches();
  if (typeof renderScores === "function") renderScores();
  if (typeof renderSchedule === "function") renderSchedule();
  if (typeof renderBrackets === "function") renderBrackets();
  if (typeof updateTournamentDashboard === "function") updateTournamentDashboard();

  if (allowAutoGeneration === true && canAutoGenerateTournamentData({ source })) {
    console.log("Auto-generation demandee depuis refresh, mais controlee", { source });
  }
}

// ============================================================
// Affichage message tournoi
// ============================================================
function showTournamentMessage(message, type = "info") {
  console.log(`[${type}] ${message}`);

  const zone = document.getElementById("tournament-message");

  if (!zone) {
    alert(message);
    return;
  }

  zone.textContent = message;
  zone.className = "tournament-message " + type;
  zone.style.display = "block";
}

// ============================================================
// Sauvegarde score uniquement apres saisie utilisateur
// ============================================================
async function saveMatchScore(matchId, team1Score, team2Score) {
  if (!matchId) {
    showTournamentMessage("Impossible d'enregistrer le score : match introuvable.", "error");
    return;
  }

  if (team1Score === null || team1Score === undefined || team1Score === "") {
    showTournamentMessage("Le score de la premiere equipe doit etre renseigne.", "warning");
    return;
  }

  if (team2Score === null || team2Score === undefined || team2Score === "") {
    showTournamentMessage("Le score de la deuxieme equipe doit etre renseigne.", "warning");
    return;
  }

  const parsedTeam1Score = Number(team1Score);
  const parsedTeam2Score = Number(team2Score);

  if (Number.isNaN(parsedTeam1Score) || Number.isNaN(parsedTeam2Score)) {
    showTournamentMessage("Les scores doivent etre numeriques.", "warning");
    return;
  }

  const { data, error } = await supabase
    .from("tournament_scores")
    .upsert(
      {
        match_id: matchId,
        team1_score: parsedTeam1Score,
        team2_score: parsedTeam2Score,
        updated_at: new Date().toISOString()
      },
      { onConflict: "match_id" }
    )
    .select();

  if (error) {
    console.error("Erreur saveMatchScore :", error);
    showTournamentMessage("Erreur pendant l'enregistrement du score.", "error");
    return;
  }

  showTournamentMessage("Score enregistre.", "success");

  await loadTournamentData({ allowAutoGeneration: false, source: "score_saved" });
  refreshTournamentScreens({ allowAutoGeneration: false, source: "score_saved" });

  return data;
}

// ============================================================
// Affichage score non renseigne
// ============================================================
function getScoreTextForMatch(matchId) {
  const scores = window.tournamentScores || [];

  const score = scores.find(function(item) {
    return item.match_id === matchId;
  });

  if (!score) {
    return "Score non renseigne";
  }

  return `${score.team1_score} - ${score.team2_score}`;
}
