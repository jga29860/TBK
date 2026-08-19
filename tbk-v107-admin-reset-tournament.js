/* TBK V107 - Bouton administrateur de reinitialisation tournoi
   Etapes executees :
   1) export SQL complet des donnees tournoi courantes ;
   2) suppression des donnees relationnelles du tournoi courant ;
   3) rechargement de la configuration minimale necessaire au site.
*/
(function(){
  const CFG_KEY = 'tbk_supabase_shared_config_v66';
  const TOURNAMENT_NAME = 'Tournoi TBK 2026-2027';
  const SEASON_DEFAULT = '2026-2027';
  const BTN_ID = 'tbkV107ResetTournamentBtn';
  const DASH_BTN_ID = 'tbkV107ResetTournamentDashboardBtn';
  const PANEL_ID = 'tbkV107ResetTournamentPanel';
  let clientCache = null;

  const TABLE_ORDER_EXPORT = [
    'tournaments',
    'tournament_competitions',
    'tournament_pools',
    'tournament_courts',
    'tournament_teams',
    'tournament_team_players',
    'tournament_checkins',
    'tournament_matches',
    'tournament_match_sets',
    'tournament_court_assignments',
    'tournament_match_events',
    'tournament_state_snapshots'
  ];

  function cfg(){
    let local = {};
    try { local = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch(e) { local = {}; }
    const g = window.TBK_SUPABASE_CONFIG || {};
    return {
      url: local.url || g.url || '',
      anonKey: local.anonKey || g.anonKey || '',
      dbEmail: local.dbEmail || g.dbEmail || '',
      dbPassword: local.dbPassword || g.dbPassword || '',
      seasonLabel: local.seasonLabel || g.seasonLabel || SEASON_DEFAULT
    };
  }

  function sb(){
    if(clientCache) return clientCache;
    const c = cfg();
    if(!window.supabase || !c.url || !c.anonKey) return null;
    clientCache = window.supabase.createClient(c.url, c.anonKey);
    return clientCache;
  }

  function isAdmin(){
    try { return typeof isAdminUser === 'function' && isAdminUser(); } catch(e) { return false; }
  }

  async function connectDb(){
    const c = cfg();
    const client = sb();
    if(!client) throw new Error('Supabase non configuré.');
    if(!c.dbEmail || !c.dbPassword) throw new Error('Compte technique Supabase incomplet.');
    const session = await client.auth.getSession();
    if(session && session.data && session.data.session && session.data.session.user && session.data.session.user.email === c.dbEmail){
      return session.data.session.user;
    }
    await client.auth.signOut();
    const { data, error } = await client.auth.signInWithPassword({ email:c.dbEmail, password:c.dbPassword });
    if(error) throw error;
    return data.user;
  }

  function esc(s){
    return String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function sqlIdent(name){
    return '"' + String(name).replace(/"/g, '""') + '"';
  }

  function sqlValue(v){
    if(v === null || v === undefined) return 'null';
    if(typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
    if(typeof v === 'boolean') return v ? 'true' : 'false';
    if(typeof v === 'object') return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb";
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  function downloadText(filename, text){
    const blob = new Blob([text], { type:'application/sql;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function showPanel(){
    let panel = document.getElementById(PANEL_ID);
    if(panel) return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'card no-print';
    panel.style.position = 'fixed';
    panel.style.right = '18px';
    panel.style.bottom = '18px';
    panel.style.zIndex = '99999';
    panel.style.maxWidth = '560px';
    panel.style.maxHeight = '70vh';
    panel.style.overflow = 'auto';
    panel.style.border = '2px solid #c00000';
    panel.style.boxShadow = '0 10px 30px #0004';
    panel.innerHTML = '<h3>♻️ Réinitialisation tournoi</h3><div id="tbkV107ResetTournamentLog" class="small"></div><div style="margin-top:8px"><button class="secondary" onclick="document.getElementById(\'' + PANEL_ID + '\').remove()">Fermer</button></div>';
    document.body.appendChild(panel);
    return panel;
  }

  function logLine(text, type){
    showPanel();
    const log = document.getElementById('tbkV107ResetTournamentLog');
    const color = type === 'error' ? '#c00000' : (type === 'ok' ? '#006100' : '#444');
    const row = document.createElement('div');
    row.style.color = color;
    row.style.margin = '4px 0';
    row.textContent = text;
    log.appendChild(row);
    try { console.log('[TBK V107 reset]', text); } catch(e) {}
  }

  async function fetchAll(table, select, build){
    const client = sb();
    let from = 0;
    const step = 1000;
    let all = [];
    while(true){
      let q = client.from(table).select(select || '*').range(from, from + step - 1);
      if(build) q = build(q);
      const { data, error } = await q;
      if(error) throw new Error(table + ' : ' + (error.message || String(error)));
      const rows = data || [];
      all = all.concat(rows);
      if(rows.length < step) break;
      from += step;
    }
    return all;
  }

  async function getTournamentContext(){
    const client = sb();
    const c = cfg();
    let { data:season, error:seasonErr } = await client.from('club_seasons').select('*').eq('label', c.seasonLabel).maybeSingle();
    if(seasonErr) throw seasonErr;
    if(!season){
      const ins = await client.from('club_seasons').insert({ label:c.seasonLabel, start_date:'2026-09-01', end_date:'2027-08-31', active:true }).select('*').maybeSingle();
      if(ins.error) throw ins.error;
      season = ins.data;
    }
    const { data:tournament, error:tournamentErr } = await client.from('tournaments').select('*').eq('season_id', season.id).eq('name', TOURNAMENT_NAME).maybeSingle();
    if(tournamentErr) throw tournamentErr;
    return { season, tournament };
  }

  async function collectTournamentRows(tournamentId){
    const result = Object.fromEntries(TABLE_ORDER_EXPORT.map(t => [t, []]));
    if(!tournamentId) return result;
    const comps = await fetchAll('tournament_competitions','*', q => q.eq('tournament_id', tournamentId));
    const compIds = comps.map(x => x.id);
    const pools = compIds.length ? await fetchAll('tournament_pools','*', q => q.in('competition_id', compIds)) : [];
    const courts = await fetchAll('tournament_courts','*', q => q.eq('tournament_id', tournamentId));
    const teams = compIds.length ? await fetchAll('tournament_teams','*', q => q.in('competition_id', compIds)) : [];
    const teamIds = teams.map(x => x.id);
    const players = teamIds.length ? await fetchAll('tournament_team_players','*', q => q.in('team_id', teamIds)) : [];
    const playerIds = players.map(x => x.id);
    const checkins = playerIds.length ? await fetchAll('tournament_checkins','*', q => q.in('team_player_id', playerIds)) : [];
    const matches = compIds.length ? await fetchAll('tournament_matches','*', q => q.in('competition_id', compIds)) : [];
    const matchIds = matches.map(x => x.id);
    const sets = matchIds.length ? await fetchAll('tournament_match_sets','*', q => q.in('match_id', matchIds)) : [];
    const assignments = matchIds.length ? await fetchAll('tournament_court_assignments','*', q => q.in('match_id', matchIds)) : [];
    const events = matchIds.length ? await fetchAll('tournament_match_events','*', q => q.in('match_id', matchIds)) : [];
    const snaps = await fetchAll('tournament_state_snapshots','*', q => q.eq('tournament_id', tournamentId));
    const tournament = await fetchAll('tournaments','*', q => q.eq('id', tournamentId));

    result.tournaments = tournament;
    result.tournament_competitions = comps;
    result.tournament_pools = pools;
    result.tournament_courts = courts;
    result.tournament_teams = teams;
    result.tournament_team_players = players;
    result.tournament_checkins = checkins;
    result.tournament_matches = matches;
    result.tournament_match_sets = sets;
    result.tournament_court_assignments = assignments;
    result.tournament_match_events = events;
    result.tournament_state_snapshots = snaps;
    return result;
  }

  function buildRestoreSql(rowsByTable){
    const lines = [];
    lines.push('-- ============================================================');
    lines.push('-- TBK - EXPORT SQL RESTAURATION TOURNOI');
    lines.push('-- Généré depuis le site avant réinitialisation');
    lines.push('-- Date : ' + new Date().toISOString());
    lines.push('-- ============================================================');
    lines.push('begin;');
    lines.push('');
    for(const table of TABLE_ORDER_EXPORT){
      const rows = rowsByTable[table] || [];
      lines.push('-- Table ' + table + ' : ' + rows.length + ' ligne(s)');
      for(const row of rows){
        const cols = Object.keys(row);
        if(!cols.length) continue;
        const values = cols.map(c => sqlValue(row[c]));
        lines.push('insert into public.' + sqlIdent(table) + ' (' + cols.map(sqlIdent).join(', ') + ') values (' + values.join(', ') + ') on conflict (id) do update set ' + cols.filter(c => c !== 'id').map(c => sqlIdent(c) + ' = excluded.' + sqlIdent(c)).join(', ') + ';');
      }
      lines.push('');
    }
    lines.push('commit;');
    lines.push('notify pgrst, \'reload schema\';');
    return lines.join('\n');
  }

  async function exportTournamentSql(){
    const ctx = await getTournamentContext();
    const rows = await collectTournamentRows(ctx.tournament ? ctx.tournament.id : null);
    const sql = buildRestoreSql(rows);
    const name = 'TBK_EXPORT_TOURNOI_AVANT_RESET_' + new Date().toISOString().replace(/[:.]/g,'-') + '.sql';
    downloadText(name, sql);
    const total = Object.values(rows).reduce((a,b) => a + b.length, 0);
    return { filename:name, totalRows:total, tournamentId:ctx.tournament ? ctx.tournament.id : null };
  }

  async function deleteIfIds(table, column, ids){
    if(!ids || !ids.length) return;
    const { error } = await sb().from(table).delete().in(column, ids);
    if(error) throw new Error('Suppression ' + table + ' : ' + (error.message || String(error)));
  }

  async function deleteTournamentData(tournamentId){
    if(!tournamentId) return;
    const rows = await collectTournamentRows(tournamentId);
    const compIds = rows.tournament_competitions.map(x => x.id);
    const teamIds = rows.tournament_teams.map(x => x.id);
    const playerIds = rows.tournament_team_players.map(x => x.id);
    const matchIds = rows.tournament_matches.map(x => x.id);

    await deleteIfIds('tournament_match_events','match_id', matchIds);
    await deleteIfIds('tournament_court_assignments','match_id', matchIds);
    await deleteIfIds('tournament_match_sets','match_id', matchIds);
    await deleteIfIds('tournament_matches','id', matchIds);
    await deleteIfIds('tournament_checkins','team_player_id', playerIds);
    await deleteIfIds('tournament_team_players','team_id', teamIds);
    await deleteIfIds('tournament_teams','id', teamIds);
    await deleteIfIds('tournament_pools','competition_id', compIds);
    await deleteIfIds('tournament_courts','tournament_id', [tournamentId]);
    await deleteIfIds('tournament_state_snapshots','tournament_id', [tournamentId]);
    await deleteIfIds('tournament_competitions','id', compIds);
    await deleteIfIds('tournaments','id', [tournamentId]);
  }

  async function upsertRows(table, rows, onConflict){
    if(!rows.length) return [];
    const { data, error } = await sb().from(table).upsert(rows, { onConflict:onConflict }).select('*');
    if(error) throw new Error('Initialisation ' + table + ' : ' + (error.message || String(error)));
    return data || [];
  }

  async function reloadMinimalConfig(){
    const client = sb();
    const c = cfg();
    let { data:season, error:seasonErr } = await client.from('club_seasons').select('*').eq('label', c.seasonLabel).maybeSingle();
    if(seasonErr) throw seasonErr;
    if(!season){
      const ins = await client.from('club_seasons').insert({ label:c.seasonLabel, start_date:'2026-09-01', end_date:'2027-08-31', active:true }).select('*').maybeSingle();
      if(ins.error) throw ins.error;
      season = ins.data;
    }

    const tournamentRows = await upsertRows('tournaments', [{
      season_id: season.id,
      name: TOURNAMENT_NAME,
      start_time: '20:00',
      rotation_minutes: 20,
      courts_count: 9,
      participant_fee: 0,
      min_rest_between_matches: 0,
      active: true
    }], 'season_id,name');
    const tournament = tournamentRows[0];

    const comps = await upsertRows('tournament_competitions', [
      { tournament_id:tournament.id, competition_key:'dm', prefix:'DM', name:'Double Mixte', team_count:32, pools_frozen:false, sort_order:10, active:true },
      { tournament_id:tournament.id, competition_key:'dh', prefix:'DH', name:'Double Homme', team_count:16, pools_frozen:false, sort_order:20, active:true }
    ], 'tournament_id,competition_key');
    const dmComp = comps.find(x => x.competition_key === 'dm');
    const dhComp = comps.find(x => x.competition_key === 'dh');

    await upsertRows('tournament_courts', Array.from({length:9}, (_,i) => ({ tournament_id:tournament.id, court_number:i+1, label:'Terrain ' + (i+1), active:true })), 'tournament_id,court_number');

    const dmPools = ['A','B','C','D','E','F','G','H'];
    const dhPools = ['A','B','C','D'];
    const pools = await upsertRows('tournament_pools', [
      ...dmPools.map((p,i) => ({ competition_id:dmComp.id, pool_key:p, sort_order:i+1 })),
      ...dhPools.map((p,i) => ({ competition_id:dhComp.id, pool_key:p, sort_order:i+1 }))
    ], 'competition_id,pool_key');
    const poolBy = {};
    pools.forEach(p => { poolBy[p.competition_id + ':' + p.pool_key] = p; });

    const teamRows = [];
    let n = 1;
    dmPools.forEach(pool => { for(let r=1;r<=4;r++,n++) teamRows.push({ competition_id:dmComp.id, team_number:n, team_code:'DM-' + String(n).padStart(2,'0'), pool_id:poolBy[dmComp.id + ':' + pool].id, pool_rank:r, active:true }); });
    n = 1;
    dhPools.forEach(pool => { for(let r=1;r<=4;r++,n++) teamRows.push({ competition_id:dhComp.id, team_number:n, team_code:'DH-' + String(n).padStart(2,'0'), pool_id:poolBy[dhComp.id + ':' + pool].id, pool_rank:r, active:true }); });
    const teams = await upsertRows('tournament_teams', teamRows, 'competition_id,team_number');

    const playerRows = [];
    teams.forEach(t => {
      playerRows.push({ team_id:t.id, player_order:1, player_name:'', club_name:'' });
      playerRows.push({ team_id:t.id, player_order:2, player_name:'', club_name:'' });
    });
    const players = await upsertRows('tournament_team_players', playerRows, 'team_id,player_order');
    await upsertRows('tournament_checkins', players.map(p => ({ team_player_id:p.id, present:false, absent:true, paid:false })), 'team_player_id');
    return { tournament, competitions:comps.length, teams:teams.length, players:players.length };
  }

  async function resetLocalState(){
    window.TBK_SUPPRESS_RELATIONAL_AUTOSAVE = true;
    try {
      if(typeof defaultState === 'function' && typeof init === 'function'){
        window.state = init(defaultState());
        if(typeof STORAGE !== 'undefined') localStorage.setItem(STORAGE, JSON.stringify(window.state));
      }
    } catch(e) {}
    try { if(typeof loadTournamentRelationalV91 === 'function') await loadTournamentRelationalV91(); } catch(e) {}
    try { if(typeof renderAll === 'function') renderAll(true); } catch(e) {}
    setTimeout(function(){ window.TBK_SUPPRESS_RELATIONAL_AUTOSAVE = false; }, 5000);
  }

  async function resetTournamentFlow(){
    if(!isAdmin()){
      alert('Action réservée au profil administrateur.');
      return;
    }
    const first = confirm('Réinitialisation des données tournoi.\n\nÉtape 1 : un export SQL de restauration sera téléchargé.\nÉtape 2 : toutes les données du tournoi seront supprimées en base.\nÉtape 3 : la configuration minimale sera recréée.\n\nContinuer ?');
    if(!first) return;
    const second = confirm('Confirmation finale : cette action supprime les données tournoi en base après export SQL.\n\nAs-tu vérifié que ton navigateur autorise le téléchargement du fichier SQL ?');
    if(!second) return;

    try{
      window.TBK_BULK_RESET_IN_PROGRESS = true;
      window.TBK_SUPPRESS_RELATIONAL_AUTOSAVE = true;
      window.TBK_REALTIME_PAUSED_UNTIL = Date.now() + 90000;
      showPanel();
      logLine('Mise en pause du temps réel et des sauvegardes automatiques...', 'info');
      try { if(typeof stopRealtimeV94 === 'function') await stopRealtimeV94(); } catch(_e) {}
      logLine('Connexion Supabase...', 'info');
      await connectDb();
      logLine('Export SQL des données tournoi...', 'info');
      const exp = await exportTournamentSql();
      logLine('Export généré : ' + exp.filename + ' (' + exp.totalRows + ' lignes).', 'ok');
      logLine('Suppression des données tournoi...', 'info');
      await deleteTournamentData(exp.tournamentId);
      logLine('Données supprimées.', 'ok');
      logLine('Rechargement configuration minimale...', 'info');
      const initResult = await reloadMinimalConfig();
      logLine('Configuration minimale prête : ' + initResult.teams + ' équipes / ' + initResult.players + ' joueurs.', 'ok');
      logLine('Réinitialisation locale et rendu...', 'info');
      await resetLocalState();
      window.TBK_BULK_RESET_IN_PROGRESS = false;
      window.TBK_SUPPRESS_RELATIONAL_AUTOSAVE = false;
      window.TBK_REALTIME_PAUSED_UNTIL = Date.now() + 10000;
      logLine('Réinitialisation terminée. Redémarrage du temps réel dans quelques secondes.', 'ok');
      setTimeout(function(){ try { if(typeof startRealtimeV94 === 'function') startRealtimeV94(); } catch(_e) {} }, 11000);
      alert('Réinitialisation tournoi terminée.\n\nLe fichier SQL d export a été téléchargé.\nLa configuration minimale du tournoi a été recréée.\nLe temps réel redémarre automatiquement dans quelques secondes.');
    } catch(e){
      window.TBK_BULK_RESET_IN_PROGRESS = false;
      window.TBK_SUPPRESS_RELATIONAL_AUTOSAVE = false;
      window.TBK_REALTIME_PAUSED_UNTIL = Date.now() + 5000;
      console.error('[TBK V107] Reset tournoi erreur', e);
      logLine('ERREUR : ' + (e.message || e), 'error');
      alert('Erreur pendant la réinitialisation tournoi : ' + (e.message || e));
    }
  }

  function injectToolbarButton(){
    const existing = document.getElementById(BTN_ID);
    if(!isAdmin()){
      if(existing) existing.remove();
      return;
    }
    if(existing) return;
    const toolbar = document.querySelector('header .toolbar');
    if(!toolbar) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.className = 'danger';
    btn.type = 'button';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '4px';
    btn.textContent = '♻️ Réinit tournoi';
    btn.title = 'Exporter puis réinitialiser les données du tournoi en base';
    btn.onclick = resetTournamentFlow;
    const anchor = toolbar.querySelector('[data-toolbar="factoryReset"]');
    if(anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    else toolbar.insertBefore(btn, toolbar.firstChild);
  }

  function injectDashboardButton(){
    const existing = document.getElementById(DASH_BTN_ID);
    if(!isAdmin()){
      if(existing) existing.remove();
      return;
    }
    const dashboard = document.getElementById('dashboard');
    if(!dashboard || !dashboard.classList.contains('active')) return;
    if(existing) return;
    const card = document.createElement('div');
    card.id = DASH_BTN_ID;
    card.className = 'card wide no-print';
    card.style.border = '2px solid #c00000';
    card.innerHTML = '<h3>Administration tournoi</h3><p class="small">Action réservée au profil administrateur : export SQL de sauvegarde, suppression des données tournoi, puis rechargement de la configuration minimale.</p><button class="danger" type="button">♻️ Réinitialiser les données du tournoi</button>';
    card.querySelector('button').onclick = resetTournamentFlow;
    dashboard.insertBefore(card, dashboard.firstChild);
  }

  function installHooks(){
    if(window.__tbkV107ResetHooks) return;
    window.__tbkV107ResetHooks = true;
    ['renderAll','updateAuthChrome','switchTab'].forEach(name => {
      const old = window[name];
      if(typeof old !== 'function') return;
      window[name] = function(){
        const r = old.apply(this, arguments);
        setTimeout(function(){ injectToolbarButton(); injectDashboardButton(); }, 0);
        setTimeout(function(){ injectToolbarButton(); injectDashboardButton(); }, 300);
        return r;
      };
    });
  }

  window.tbkV107ResetTournamentFlow = resetTournamentFlow;
  window.tbkV107ExportTournamentSql = exportTournamentSql;

  function boot(){
    installHooks();
    injectToolbarButton();
    injectDashboardButton();
    setInterval(function(){ injectToolbarButton(); injectDashboardButton(); }, 2500);
  }

  document.addEventListener('DOMContentLoaded', boot);
  setTimeout(boot, 1000);
})();
