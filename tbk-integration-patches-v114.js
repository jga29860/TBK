// ============================================================
// TBK V114 - Patches a appliquer dans les fonctions existantes
// ============================================================

// Dans generateGroups(options = {}), ajouter au tout debut :
/*
const source = options.source || "manual";
if (source === "manual") tbkMarkManualTournamentAction();
if (source !== "manual" && !tbkCanAutoGenerateTournamentData({ source })) return;
*/

// Dans generateMatches(options = {}), ajouter au tout debut :
/*
const source = options.source || "manual";
if (source === "manual") tbkMarkManualTournamentAction();
if (source !== "manual" && !tbkCanAutoGenerateTournamentData({ source })) return;

const teams = window.tournamentTeams || [];
const groups = window.tournamentGroups || [];
if (teams.length === 0) {
  tbkShowTournamentMessage("Impossible de generer les matchs : aucune equipe inscrite.", "warning");
  return;
}
if (groups.length === 0) {
  tbkShowTournamentMessage("Impossible de generer les matchs : aucune poule disponible.", "warning");
  return;
}
*/

// Dans generateSchedule(options = {}), ajouter au tout debut :
/*
const source = options.source || "manual";
if (source === "manual") tbkMarkManualTournamentAction();
if (source !== "manual" && !tbkCanAutoGenerateTournamentData({ source })) return;

const matches = window.tournamentMatches || [];
if (matches.length === 0) {
  tbkShowTournamentMessage("Impossible de generer le planning : aucun match disponible.", "warning");
  return;
}
*/

// A supprimer partout apres reset :
// generateGroups();
// generateMatches();
// generateSchedule();

// A remplacer, si un automatisme est vraiment voulu hors reset, par :
// tbkRunTournamentAutoGeneration({ source: "contexte" });

// A supprimer absolument dans la generation des matchs :
/*
await supabase.from("tournament_scores").insert({
  match_id: match.id,
  team1_score: 0,
  team2_score: 0
});
*/

// Affichage score :
// Remplacer les affichages du type `${match.team1_score || 0} - ${match.team2_score || 0}`
// par : tbkGetScoreTextForMatch(match.id)
