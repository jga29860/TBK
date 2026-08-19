/* TBK V95B - Diagnostic relationnel Tournoi / Emargement / Supabase
   Objectif : fournir un diagnostic non destructif de la base relationnelle
   et comparer les donnees tournoi presentes localement dans le site avec
   les tables Supabase.
*/
(function(){
  const CFG_KEY = 'tbk_supabase_shared_config_v66';
  const LOCAL_STATE_KEY = 'tbk_tournois_dm_dh_v1';
  const PANEL_ID = 'tbkV95BDiagnosticPanel';
  const BODY_ID = 'tbkV95BDiagnosticBody';
  const LOG_KEY = 'tbk_v95b_diagnostic_logs';
  let clientCache = null;

  function cfg(){
    let local = {};
    try { local = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch(e) { local = {}; }
    const g = window.TBK_SUPABASE_CONFIG || {};
    return {
      url: local.url || g.url || '',
      anonKey: local.anonKey || g.anonKey || '',
      dbEmail: local.dbEmail || g.dbEmail || '',
      dbPassword: local.dbPassword || g.dbPassword || '',
      seasonLabel: local.seasonLabel || g.seasonLabel || '2026-2027'
    };
  }

  function sb(){
    if(clientCache) return clientCache;
    const c = cfg();
    if(!window.supabase || !c.url || !c.anonKey) return null;
    clientCache = window.supabase.createClient(c.url, c.anonKey);
    return clientCache;
  }

  async function connectDb(){
    const c = cfg();
    const supa = sb();
    if(!supa) throw new Error('Client Supabase non configurable. Verifier URL et cle anon.');
    if(!c.dbEmail || !c.dbPassword) throw new Error('Compte technique Supabase incomplet.');
    const session = await supa.auth.getSession();
    if(session && session.data && session.data.session && session.data.session.user && session.data.session.user.email === c.dbEmail){
      return session.data.session.user;
    }
    await supa.auth.signOut();
    const { data, error } = await supa.auth.signInWithPassword({ email:c.dbEmail, password:c.dbPassword });
    if(error) throw error;
    return data.user;
  }

  function nowIso(){ return new Date().toISOString(); }
  function safe(v){ return v === undefined ? null : v; }
  function normText(v){ return String(v || '').trim(); }
  function arr(v){ return Array.isArray(v) ? v : []; }

  function writeLog(level, step, detail){
    const item = { at:nowIso(), level, step, detail:safe(detail) };
    let logs = [];
    try { logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch(e) { logs = []; }
    logs.push(item);
    logs = logs.slice(-300);
    localStorage.setItem(LOG_KEY, JSON.stringify(logs));
    try { console[level === 'error' ? 'error' : 'log']('[TBK V95B Diagnostic]', step, detail || ''); } catch(e) {}
    refreshPanel();
  }

  function readLogs(){
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch(e) { return []; }
  }

  function localTournamentSummary(){
    let st = null;
    try { st = JSON.parse(localStorage.getItem(LOCAL_STATE_KEY) || 'null'); } catch(e) { st = null; }
    const out = {
      hasLocalState: !!st,
      dmTeams: 0,
      dhTeams: 0,
      dmTeamsWithParticipantOrClub: 0,
      dhTeamsWithParticipantOrClub: 0,
      dmPoolMatches: 0,
      dhPoolMatches: 0,
      dmKoMatches: 0,
      dhKoMatches: 0,
      checkinDmTeams: 0,
      checkinDhTeams: 0,
      sampleTeams: []
    };
    if(!st) return out;
    ['dm','dh'].forEach(key => {
      const teams = Object.values((st[key] && st[key].teams) || {});
      out[key + 'Teams'] = teams.length;
      out[key + 'TeamsWithParticipantOrClub'] = teams.filter(t => [t.j1,t.j2,t.club,t.club1,t.club2].some(x => normText(x))).length;
      out[key + 'PoolMatches'] = arr(st[key] && st[key].matches).length;
      out[key + 'KoMatches'] = arr(st[key] && st[key].ko).length;
      out['checkin' + key.toUpperCase()[0] + key.slice(1) + 'Teams'] = Object.keys((st.checkin && st.checkin[key]) || {}).length;
      teams.slice(0, 4).forEach(t => out.sampleTeams.push({ comp:key, id:t.id, pool:t.pool, pos:t.pos, j1:t.j1 || '', club1:t.club1 || t.club || '', j2:t.j2 || '', club2:t.club2 || t.club || '' }));
    });
    return out;
  }

  async function countTable(table){
    const supa = sb();
    const { count, error } = await supa.from(table).select('id', { count:'exact', head:true });
    if(error) return { table, ok:false, error:error.message || String(error) };
    return { table, ok:true, count:count || 0 };
  }

  function byId(rows){ return Object.fromEntries(arr(rows).map(r => [r.id, r])); }

  async function fetchAll(table, select, filterFn){
    const q = sb().from(table).select(select || '*');
    const query = filterFn ? filterFn(q) : q;
    const { data, error } = await query;
    if(error) throw new Error(table + ' : ' + (error.message || String(error)));
    return data || [];
  }

  async function runDiagnostic(){
    const result = {
      at:nowIso(),
      config:{},
      auth:{},
      local:localTournamentSummary(),
      database:{},
      tournament:{},
      recommendations:[]
    };

    try{
      const c = cfg();
      result.config = {
        supabaseJsLoaded: !!window.supabase,
        urlConfigured: !!c.url,
        anonKeyConfigured: !!c.anonKey,
        dbEmailConfigured: !!c.dbEmail,
        dbPasswordPresent: !!c.dbPassword,
        seasonLabel: c.seasonLabel,
        currentSiteUser: (typeof currentUser === 'function' ? currentUser() : null)
      };
      writeLog('info','diagnostic.start',result.config);

      const dbUser = await connectDb();
      result.auth = { ok:true, dbUserEmail:dbUser && dbUser.email, dbUserId:dbUser && dbUser.id };

      const coreTables = [
        'club_seasons','tournaments','tournament_competitions','tournament_pools','tournament_teams',
        'tournament_team_players','tournament_checkins','tournament_courts','tournament_matches',
        'tournament_match_sets','tournament_court_assignments','tournament_match_events',
        'tournament_state_snapshots','app_state_snapshots'
      ];
      result.database.tableCounts = [];
      for(const t of coreTables){ result.database.tableCounts.push(await countTable(t)); }

      const seasons = await fetchAll('club_seasons','id,label,active', q => q.eq('label', c.seasonLabel).limit(1));
      const season = seasons[0] || null;
      result.tournament.season = season;
      if(!season){
        result.recommendations.push('Saison introuvable : executer le script SQL V90/V91 ou verifier seasonLabel.');
        writeLog('error','diagnostic.noSeason',result);
        return result;
      }

      const tournaments = await fetchAll('tournaments','id,name,active,start_time,rotation_minutes,courts_count,participant_fee,min_rest_between_matches', q => q.eq('season_id', season.id).order('created_at', { ascending:false }));
      result.tournament.tournaments = tournaments;
      const tournament = tournaments.find(t => t.active) || tournaments[0] || null;
      result.tournament.activeTournament = tournament;
      if(!tournament){
        result.recommendations.push('Aucun tournoi trouve pour la saison : executer TBK_V91_schema_tournoi_relationnel.sql.');
        writeLog('error','diagnostic.noTournament',result);
        return result;
      }

      const comps = await fetchAll('tournament_competitions','id,competition_key,prefix,name,team_count,pools_frozen,active', q => q.eq('tournament_id', tournament.id));
      const compById = byId(comps);
      result.tournament.competitions = comps;
      const compIds = comps.map(c => c.id);

      const pools = compIds.length ? await fetchAll('tournament_pools','id,competition_id,pool_key,sort_order', q => q.in('competition_id', compIds)) : [];
      const teams = compIds.length ? await fetchAll('tournament_teams','id,competition_id,team_number,team_code,pool_id,pool_rank,active', q => q.in('competition_id', compIds).order('team_number', { ascending:true })) : [];
      const teamIds = teams.map(t => t.id);
      const players = teamIds.length ? await fetchAll('tournament_team_players','id,team_id,player_order,player_name,club_name', q => q.in('team_id', teamIds)) : [];
      const playerIds = players.map(p => p.id);
      const checkins = playerIds.length ? await fetchAll('tournament_checkins','id,team_player_id,present,absent,paid', q => q.in('team_player_id', playerIds)) : [];
      const courts = await fetchAll('tournament_courts','id,court_number,label,active', q => q.eq('tournament_id', tournament.id));
      const matches = compIds.length ? await fetchAll('tournament_matches','id,competition_id,match_number,phase,bracket,pool_id,team_a_id,team_b_id,seed_a,seed_b,rotation_label,estimated_time,done,winner_team_id,loser_team_id', q => q.in('competition_id', compIds)) : [];
      const matchIds = matches.map(m => m.id);
      const sets = matchIds.length ? await fetchAll('tournament_match_sets','id,match_id,set_number,score_a,score_b', q => q.in('match_id', matchIds)) : [];
      const assignments = matchIds.length ? await fetchAll('tournament_court_assignments','id,match_id,court_id,assigned_at,released_at,manual', q => q.in('match_id', matchIds)) : [];

      result.tournament.counts = {
        competitions: comps.length,
        pools: pools.length,
        teams: teams.length,
        players: players.length,
        checkins: checkins.length,
        courts: courts.length,
        matches: matches.length,
        sets: sets.length,
        courtAssignments: assignments.length
      };

      result.tournament.byCompetition = comps.map(comp => {
        const compTeams = teams.filter(t => t.competition_id === comp.id);
        const compTeamIds = new Set(compTeams.map(t => t.id));
        const compPlayers = players.filter(p => compTeamIds.has(p.team_id));
        const compMatches = matches.filter(m => m.competition_id === comp.id);
        return {
          competition_key: comp.competition_key,
          expectedTeams: comp.team_count,
          teams: compTeams.length,
          players: compPlayers.length,
          playersWithName: compPlayers.filter(p => normText(p.player_name)).length,
          playersWithClub: compPlayers.filter(p => normText(p.club_name)).length,
          teamsWithAtLeastOneParticipantOrClub: compTeams.filter(t => compPlayers.some(p => p.team_id === t.id && (normText(p.player_name) || normText(p.club_name)))).length,
          pools: pools.filter(p => p.competition_id === comp.id).length,
          matches: compMatches.length,
          completedMatches: compMatches.filter(m => m.done).length,
          sets: sets.filter(s => compMatches.some(m => m.id === s.match_id)).length
        };
      });

      result.tournament.missing = {
        teamsWithoutTwoPlayers: teams.filter(t => players.filter(p => p.team_id === t.id).length !== 2).map(t => t.team_code || t.team_number),
        playersWithoutCheckin: players.filter(p => !checkins.some(c => c.team_player_id === p.id)).map(p => p.id),
        matchesWithoutThreeSets: matches.filter(m => sets.filter(s => s.match_id === m.id).length !== 3).map(m => ({ match_number:m.match_number, competition: compById[m.competition_id] && compById[m.competition_id].competition_key }))
      };

      const snapshotsTournament = await fetchAll('tournament_state_snapshots','id,snapshot_name,created_at', q => q.eq('tournament_id', tournament.id).order('created_at', { ascending:false }).limit(5));
      const appSnapshots = await fetchAll('app_state_snapshots','id,snapshot_name,created_at', q => q.eq('season_id', season.id).order('created_at', { ascending:false }).limit(5));
      result.tournament.lastSnapshots = { tournament_state_snapshots:snapshotsTournament, app_state_snapshots:appSnapshots };

      if(result.local.dmTeamsWithParticipantOrClub + result.local.dhTeamsWithParticipantOrClub > 0 && result.tournament.byCompetition.reduce((s,x) => s + x.teamsWithAtLeastOneParticipantOrClub, 0) === 0){
        result.recommendations.push('Des participants/clubs existent localement mais pas en base : executer TBK_V93_INSERT_PARTICIPANTS_CLUBS_DEPUIS_SITE.sql ou sauvegarder depuis le site.');
      }
      if(result.tournament.counts.teams === 0) result.recommendations.push('Aucune equipe en base : executer le script V91 puis recharger le site.');
      if(result.tournament.missing.playersWithoutCheckin.length) result.recommendations.push('Des joueurs n ont pas de ligne emargement : recreer les checkins manquants.');
      if(result.tournament.missing.matchesWithoutThreeSets.length) result.recommendations.push('Certains matchs n ont pas 3 sets en base : lancer la synchronisation scores V92.');
      if(!result.recommendations.length) result.recommendations.push('Diagnostic OK : aucune anomalie bloquante detectee.');

      writeLog('ok','diagnostic.end',result);
      return result;
    }catch(e){
      result.error = e.message || String(e);
      writeLog('error','diagnostic.error',result.error);
      return result;
    }
  }

  function htmlEscape(s){
    return String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function renderResult(result){
    if(!result) return 'Aucun diagnostic lance.';
    const chunks = [];
    chunks.push('Date : ' + result.at);
    chunks.push('Configuration : ' + JSON.stringify(result.config || {}, null, 2));
    chunks.push('Authentification DB : ' + JSON.stringify(result.auth || {}, null, 2));
    chunks.push('Etat local navigateur : ' + JSON.stringify(result.local || {}, null, 2));
    chunks.push('Compteurs base : ' + JSON.stringify((result.database && result.database.tableCounts) || [], null, 2));
    chunks.push('Tournoi : ' + JSON.stringify(result.tournament || {}, null, 2));
    chunks.push('Recommandations : ' + JSON.stringify(result.recommendations || [], null, 2));
    if(result.error) chunks.push('ERREUR : ' + result.error);
    return chunks.join('\n\n');
  }

  let lastResult = null;

  async function launchDiagnostic(){
    const body = document.getElementById(BODY_ID);
    if(body) body.innerHTML = '<pre>Diagnostic V95B en cours...</pre>';
    lastResult = await runDiagnostic();
    refreshPanel();
  }

  function exportDiagnostic(){
    const payload = lastResult || { logs:readLogs(), exportedAt:nowIso() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tbk_v95b_diagnostic.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function clearLogs(){
    localStorage.removeItem(LOG_KEY);
    lastResult = null;
    refreshPanel();
  }

  function refreshPanel(){
    const body = document.getElementById(BODY_ID);
    if(!body) return;
    const logs = readLogs().slice(-20);
    body.innerHTML = '<pre>' + htmlEscape(renderResult(lastResult)) + '</pre>' +
      '<h4>Derniers logs</h4><pre>' + htmlEscape(JSON.stringify(logs, null, 2)) + '</pre>';
  }

  function closePanel(){
    const p = document.getElementById(PANEL_ID);
    if(p) p.remove();
  }

  function openPanel(){
    closePanel();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'supabase-debug-panel no-print';
    panel.innerHTML = '<h3>🧪 Diagnostic TBK V95B</h3>' +
      '<div class="debug-row">' +
      '<button type="button" onclick="runTbkV95BDiagnostic()">Lancer diagnostic</button>' +
      '<button type="button" onclick="exportTbkV95BDiagnostic()">Exporter JSON</button>' +
      '<button type="button" onclick="clearTbkV95BDiagnostic()">Vider logs</button>' +
      '<button type="button" class="danger" onclick="closeTbkV95BDiagnosticPanel()">Fermer</button>' +
      '</div><div id="' + BODY_ID + '"></div>';
    document.body.appendChild(panel);
    refreshPanel();
  }

  function injectButton(){
    if(document.getElementById('tbkV95BDiagnosticButton')) return;
    const btn = document.createElement('button');
    btn.id = 'tbkV95BDiagnosticButton';
    btn.type = 'button';
    btn.className = 'supabase-debug-float-btn no-print';
    btn.style.bottom = '62px';
    btn.textContent = '🧪 Diagnostic V95B';
    btn.onclick = openPanel;
    document.body.appendChild(btn);
  }

  window.runTbkV95BDiagnostic = launchDiagnostic;
  window.exportTbkV95BDiagnostic = exportDiagnostic;
  window.clearTbkV95BDiagnostic = clearLogs;
  window.closeTbkV95BDiagnosticPanel = closePanel;
  window.openTbkV95BDiagnosticPanel = openPanel;

  document.addEventListener('DOMContentLoaded', injectButton);
  setTimeout(injectButton, 600);
})();
