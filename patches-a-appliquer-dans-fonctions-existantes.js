// ============================================================
// TBK V76.1 - Patches a appliquer dans les fonctions existantes
// ============================================================

// 1. Au debut de generateGroups(options = {})
async function generateGroups_PATCH_EXEMPLE(options = {}) {
  const source = options.source || "manual";

  if (source === "manual") {
    TOURNAMENT_JUST_RESET = false;
  }

  if (source !== "manual" && !canAutoGenerateTournamentData({ source })) {
    return;
  }

  const teams = window.tournamentTeams || [];

  if (teams.length === 0) {
    showTournamentMessage("Impossible de generer les poules : aucune equipe inscrite.", "warning");
    return;
  }

  // Suite de la logique existante de generation des poules...
}

// 2. Au debut de generateMatches(options = {})
async function generateMatches_PATCH_EXEMPLE(options = {}) {
  const source = options.source || "manual";

  if (source === "manual") {
    TOURNAMENT_JUST_RESET = false;
  }

  if (source !== "manual" && !canAutoGenerateTournamentData({ source })) {
    return;
  }

  const teams = window.tournamentTeams || [];
  const groups = window.tournamentGroups || [];

  if (teams.length === 0) {
    showTournamentMessage("Impossible de generer les matchs : aucune equipe inscrite.", "warning");
    return;
  }

  if (groups.length === 0) {
    showTournamentMessage("Impossible de generer les matchs : aucune poule disponible.", "warning");
    return;
  }

  // Important : ne pas creer de score par defaut ici.
  // Aucun insert dans tournament_scores ne doit etre fait pendant la generation des matchs.
}

// 3. Au debut de generateSchedule(options = {})
async function generateSchedule_PATCH_EXEMPLE(options = {}) {
  const source = options.source || "manual";

  if (source === "manual") {
    TOURNAMENT_JUST_RESET = false;
  }

  if (source !== "manual" && !canAutoGenerateTournamentData({ source })) {
    return;
  }

  const matches = window.tournamentMatches || [];

  if (matches.length === 0) {
    showTournamentMessage("Impossible de generer le planning : aucun match disponible.", "warning");
    return;
  }

  // Suite de la logique existante de generation du planning...
}

// 4. A supprimer partout dans le code
// await generateGroups();
// await generateMatches();
// await generateSchedule();

// 5. A remplacer par un appel controle seulement si necessaire
// await runTournamentAutoGeneration({ source: "nom_du_contexte" });

// 6. A supprimer absolument pendant la generation des matchs
// await supabase.from("tournament_scores").insert({
//   match_id: match.id,
//   team1_score: 0,
//   team2_score: 0
// });

// 7. Affichage des scores
// Remplacer :
// const scoreText = `${match.team1_score || 0} - ${match.team2_score || 0}`;
// Par :
// const scoreText = getScoreTextForMatch(match.id);
