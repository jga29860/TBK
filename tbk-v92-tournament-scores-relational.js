/* TBK V92 - Scores tournoi relationnels Supabase
   Objectif : persister les matchs et scores dans tournament_matches / tournament_match_sets.
   Strate prudente : conserve le moteur local de calcul/classement, mais recharge/sauvegarde les scores en base.
*/
(function(){
  const CFG_KEY = 'tbk_supabase_shared_config_v66';
  const TOURNAMENT_NAME = 'Tournoi TBK 2026-2027';
  const SAVE_DELAY_MS = 700;

  let clientCache = null;
  let dbUser = null;
  let dbSeason = null;
  let dbTournament = null;
  let dbCompetitions = {};
  let dbPoolsByKey = { dm:{}, dh:{} };
  let dbTeamsByNumber = { dm:{}, dh:{} };
  let dbMatchesByKey = { dm:{}, dh:{} };
  let saveTimer = null;
  let saving = false;
  let pending = false;
  let loadingRemote = false;
  let loadedOnce = false;

  function log(level, step, detail){
    if(typeof tbkDebugLog === 'function') tbkDebugLog(level, step, detail);
    try { console.log('[TBK V92]', step, detail || ''); } catch(e) {}
  }

  function cfg(){
    let local = {};
    try { local = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch(e) { local = {}; }
    const globalCfg = window.TBK_SUPABASE_CONFIG || {};
    return {
      url: local.url || globalCfg.url || '',
      anonKey: local.anonKey || globalCfg.anonKey || '',
      dbEmail: local.dbEmail || globalCfg.dbEmail || '',
      dbPassword: local.dbPassword || globalCfg.dbPassword || '',
      seasonLabel: local.seasonLabel || globalCfg.seasonLabel || '2026-2027'
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
    const client = sb();
    if(!client) throw new Error('Client Supabase non configuré.');
    if(!c.dbEmail || !c.dbPassword) throw new Error('Compte technique Supabase incomplet.');
    const session = await client.auth.getSession();
    if(session?.data?.session?.user?.email === c.dbEmail){
      dbUser = session.data.session.user;
      return dbUser;
    }
    await client.auth.signOut();
    const { data, error } = await client.auth.signInWithPassword({ email:c.dbEmail, password:c.dbPassword });
    if(error) throw error;
    dbUser = data.user;
    return dbUser;
  }

  async function getSeason(){
    if(dbSeason) return dbSeason;
    const client = sb();
    const c = cfg();
    let { data, error } = await client.from('club_seasons').select('id,label,active').eq('label', c.seasonLabel).maybeSingle();
    if(error) throw error;
    if(!data){
      const fallback = await client.from('club_seasons').select('id,label,active').eq('active', true).limit(1).maybeSingle();
      if(fallback.error) throw fallback.error;
      data = fallback.data;
    }
    if(!data) throw new Error('Saison Supabase introuvable.');
    dbSeason = data;
    return data;
  }

  async function ensureMetadata(){
    const client = sb();
    await connectDb();
    const season = await getSeason();

    let tr = await client.from('tournaments').select('*').eq('season_id', season.id).eq('name', TOURNAMENT_NAME).maybeSingle();
    if(tr.error) throw tr.error;
    if(!tr.data){
      const ins = await client.from('tournaments').insert({ season_id:season.id, name:TOURNAMENT_NAME, active:true }).select('*').maybeSingle();
      if(ins.error) throw ins.error;
      tr.data = ins.data;
    }
    dbTournament = tr.data;

    const comps = await client.from('tournament_competitions').select('*').eq('tournament_id', dbTournament.id).eq('active', true).order('sort_order', {ascending:true});
    if(comps.error) throw comps.error;
    dbCompetitions = {};
    (comps.data || []).forEach(c => { dbCompetitions[c.competition_key] = c; });

    const compIds = (comps.data || []).map(c => c.id);
    if(!compIds.length) throw new Error('Aucune compétition tournoi trouvée.');

    const pools = await client.from('tournament_pools').select('*').in('competition_id', compIds).order('sort_order', {ascending:true});
    if(pools.error) throw pools.error;
    dbPoolsByKey = { dm:{}, dh:{} };
    (pools.data || []).forEach(p => {
      const comp = (comps.data || []).find(c => c.id === p.competition_id);
      if(comp) dbPoolsByKey[comp.competition_key][p.pool_key] = p;
    });

    const teams = await client.from('tournament_teams').select('*').in('competition_id', compIds).eq('active', true).order('team_number', {ascending:true});
    if(teams.error) throw teams.error;
    dbTeamsByNumber = { dm:{}, dh:{} };
    (teams.data || []).forEach(t => {
      const comp = (comps.data || []).find(c => c.id === t.competition_id);
      if(comp) dbTeamsByNumber[comp.competition_key][t.team_number] = t;
    });

    return compIds;
  }

  function allLocalMatches(){
    const out = [];
    if(typeof getAllMatches === 'function'){
      for(const key of ['dm','dh']) (getAllMatches(key) || []).forEach(m => out.push(m));
      return out;
    }
    for(const key of ['dm','dh']){
      const comp = state && state[key] ? state[key] : {};
      [...(comp.matches || []), ...(comp.ko || [])].forEach(m => out.push(m));
    }
    return out;
  }

  function localHasScores(){
    return allLocalMatches().some(m => {
      if(m.done || m.winner || m.loser) return true;
      return (m.scores || []).some(s => Number.isFinite(s[0]) || Number.isFinite(s[1]));
    });
  }

  function scoresHaveValues(sets){
    return (sets || []).some(s => Number.isFinite(s.score_a) || Number.isFinite(s.score_b));
  }

  function normalizeScoreValue(v){
    if(v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function matchNumber(m){
    return Number(m.id ?? m.n ?? m.match_number);
  }

  function inferBracket(m){
    if(m.bracket) return m.bracket;
    const p = String(m.phase || '').toLowerCase();
    if(p.includes('consol')) return 'consolante';
    if(p.includes('principal')) return 'principal';
    if(p.includes('poule')) return null;
    return m.bracket || null;
  }

  function dbTeamId(key, value){
    if(!value || typeof value !== 'number') return null;
    const row = dbTeamsByNumber[key] ? dbTeamsByNumber[key][value] : null;
    return row ? row.id : null;
  }

  function resolveTeamNumberSafe(key, seed){
    try{
      if(typeof seed === 'number') return seed;
      if(typeof resolveSeed === 'function'){
        const resolved = resolveSeed(key, seed);
        return Number.isFinite(resolved) ? resolved : null;
      }
    }catch(e){ return null; }
    return null;
  }

  function computeWinnerSafe(m){
    try{
      if(typeof computeMatchWinner === 'function') computeMatchWinner(m);
    }catch(e){}
    return { winner:m.winner || null, loser:m.loser || null };
  }

  function localMatchPayload(m){
    const key = m.comp;
    const comp = dbCompetitions[key];
    if(!comp) return null;
    const aNum = resolveTeamNumberSafe(key, m.a);
    const bNum = resolveTeamNumberSafe(key, m.b);
    const w = computeWinnerSafe(m);
    const poolRow = m.pool && dbPoolsByKey[key] ? dbPoolsByKey[key][m.pool] : null;
    return {
      competition_id: comp.id,
      match_number: matchNumber(m),
      phase: m.phase || 'Poules',
      bracket: inferBracket(m),
      pool_id: poolRow ? poolRow.id : null,
      team_a_id: dbTeamId(key, aNum),
      team_b_id: dbTeamId(key, bNum),
      seed_a: (typeof m.a === 'number') ? null : String(m.a || ''),
      seed_b: (typeof m.b === 'number') ? null : String(m.b || ''),
      rotation_label: m.rotation || null,
      estimated_time: m.time || null,
      started_at: m.startedAt ? new Date(m.startedAt).toISOString() : null,
      ended_at: m.endedAt ? new Date(m.endedAt).toISOString() : null,
      done: !!m.done,
      winner_team_id: dbTeamId(key, w.winner),
      loser_team_id: dbTeamId(key, w.loser),
      updated_at: new Date().toISOString()
    };
  }

  async function upsertLocalMatches(){
    const client = sb();
    const rows = allLocalMatches().map(localMatchPayload).filter(Boolean).filter(r => Number.isFinite(r.match_number));
    if(!rows.length) return [];
    const res = await client.from('tournament_matches').upsert(rows, { onConflict:'competition_id,match_number' }).select('id,competition_id,match_number');
    if(res.error) throw res.error;
    return res.data || [];
  }

  function rebuildDbMatchMap(matchRows){
    dbMatchesByKey = { dm:{}, dh:{} };
    const compById = {};
    Object.entries(dbCompetitions).forEach(([key, comp]) => { compById[comp.id] = key; });
    (matchRows || []).forEach(r => {
      const key = compById[r.competition_id];
      if(key) dbMatchesByKey[key][r.match_number] = r;
    });
  }

  async function loadRemoteMatchesAndSets(){
    const client = sb();
    const compIds = await ensureMetadata();
    const matches = await client.from('tournament_matches').select('*').in('competition_id', compIds).order('match_number', {ascending:true});
    if(matches.error) throw matches.error;
    const ids = (matches.data || []).map(m => m.id);
    const sets = ids.length ? await client.from('tournament_match_sets').select('*').in('match_id', ids).order('set_number', {ascending:true}) : { data:[], error:null };
    if(sets.error) throw sets.error;
    rebuildDbMatchMap(matches.data || []);
    return { matches: matches.data || [], sets: sets.data || [] };
  }

  function remoteHasScores(matches, sets){
    return (matches || []).some(m => m.done || m.winner_team_id || m.started_at || m.ended_at) || scoresHaveValues(sets || []);
  }

  function applyRemoteScoresToState(matches, sets){
    const compById = {};
    Object.entries(dbCompetitions).forEach(([key, comp]) => { compById[comp.id] = key; });
    const setsByMatch = {};
    (sets || []).forEach(s => {
      setsByMatch[s.match_id] = setsByMatch[s.match_id] || {};
      setsByMatch[s.match_id][s.set_number] = s;
    });
    loadingRemote = true;
    try{
      for(const row of matches || []){
        const key = compById[row.competition_id];
        if(!key) continue;
        const local = allLocalMatches().find(m => m.comp === key && matchNumber(m) === row.match_number);
        if(!local) continue;
        const matchSets = setsByMatch[row.id] || {};
        const nextScores = [];
        for(let i=1;i<=3;i++){
          const s = matchSets[i] || {};
          nextScores.push([normalizeScoreValue(s.score_a), normalizeScoreValue(s.score_b)]);
        }
        local.scores = nextScores;
        local.done = !!row.done;
        local.startedAt = row.started_at ? new Date(row.started_at).getTime() : local.startedAt;
        local.endedAt = row.ended_at ? new Date(row.ended_at).getTime() : local.endedAt;
        try { if(typeof computeMatchWinner === 'function') computeMatchWinner(local); } catch(e) {}
      }
      try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch(e) {}
    } finally {
      loadingRemote = false;
    }
  }

  async function saveSetsForMatches(){
    const client = sb();
    const setRows = [];
    for(const m of allLocalMatches()){
      const key = m.comp;
      const number = matchNumber(m);
      const dbMatch = dbMatchesByKey[key] ? dbMatchesByKey[key][number] : null;
      if(!dbMatch) continue;
      for(let i=0;i<3;i++){
        const s = (m.scores || [])[i] || [null,null];
        setRows.push({
          match_id: dbMatch.id,
          set_number: i+1,
          score_a: normalizeScoreValue(s[0]),
          score_b: normalizeScoreValue(s[1]),
          updated_at: new Date().toISOString()
        });
      }
    }
    if(!setRows.length) return;
    const res = await client.from('tournament_match_sets').upsert(setRows, { onConflict:'match_id,set_number' });
    if(res.error) throw res.error;
  }

  async function writeScoreEvents(){
    const client = sb();
    const eventRows = [];
    for(const m of allLocalMatches().filter(x => x.done)){
      const dbMatch = dbMatchesByKey[m.comp] ? dbMatchesByKey[m.comp][matchNumber(m)] : null;
      if(!dbMatch) continue;
      eventRows.push({
        match_id: dbMatch.id,
        event_type: 'score_saved_v92',
        event_data: { scores: m.scores, done: !!m.done, winner: m.winner || null, loser: m.loser || null },
        created_by: dbUser?.id || null
      });
    }
    if(eventRows.length){
      // Limiter le bruit : evenement uniquement pour les matchs termines, sans bloquer si erreur RLS.
      const res = await client.from('tournament_match_events').insert(eventRows.slice(-20));
      if(res.error) log('warn','scores.v92.events',res.error.message);
    }
  }

  async function loadTournamentScoresRelationalV92(){
    const client = sb();
    if(!client) return false;
    await connectDb();
    const remote = await loadRemoteMatchesAndSets();
    const hasRemote = remoteHasScores(remote.matches, remote.sets);
    const hasLocal = localHasScores();

    if(!hasRemote && hasLocal){
      log('warn','scores.v92.load','Aucun score en base : conservation des scores locaux et sauvegarde vers Supabase.');
      await saveTournamentScoresRelationalV92(false);
      loadedOnce = true;
      return false;
    }
    if(hasRemote){
      applyRemoteScoresToState(remote.matches, remote.sets);
      loadedOnce = true;
      log('ok','scores.v92.load',{ matches: remote.matches.length, sets: remote.sets.length, source:'Supabase relationnel' });
      return true;
    }
    // Pas de score local ni distant : creer les references de matchs pour faciliter les prochaines sauvegardes.
    const matchRows = await upsertLocalMatches();
    rebuildDbMatchMap(matchRows);
    await saveSetsForMatches();
    loadedOnce = true;
    log('ok','scores.v92.init','Référentiel matchs initialisé sans score.');
    return false;
  }

  async function saveTournamentScoresRelationalV92(showMessage){
    if(loadingRemote) return false;
    if(!currentUser || !currentUser()) return false;
    const client = sb();
    if(!client){ if(showMessage) alert('Supabase non configuré.'); return false; }
    if(saving){ pending = true; return false; }
    saving = true;
    try{
      await connectDb();
      await ensureMetadata();
      const matchRows = await upsertLocalMatches();
      rebuildDbMatchMap(matchRows);
      await saveSetsForMatches();
      await writeScoreEvents();
      log('ok','scores.v92.save',{ matches: matchRows.length, savedAt:new Date().toISOString() });
      if(showMessage) alert('Scores sauvegardés dans Supabase.');
      return true;
    } catch(e){
      console.error('[TBK V92] Erreur sauvegarde scores', e);
      log('error','scores.v92.save', e.message || String(e));
      if(showMessage) alert('Erreur sauvegarde scores Supabase : ' + (e.message || e));
      return false;
    } finally {
      saving = false;
      if(pending){ pending = false; scheduleTournamentScoresSaveV92('pending'); }
    }
  }

  function scheduleTournamentScoresSaveV92(reason){
    if(loadingRemote) return;
    if(!currentUser || !currentUser()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){ saveTournamentScoresRelationalV92(false); }, SAVE_DELAY_MS);
    log('info','scores.v92.save.scheduled',{ reason: reason || 'unknown' });
  }

  window.loadTournamentScoresRelationalV92 = loadTournamentScoresRelationalV92;
  window.saveTournamentScoresRelationalV92 = saveTournamentScoresRelationalV92;
  window.scheduleTournamentScoresSaveV92 = scheduleTournamentScoresSaveV92;

  const previousSetScoreById = window.setScoreById;
  if(typeof previousSetScoreById === 'function'){
    window.setScoreById = function(){
      const out = previousSetScoreById.apply(this, arguments);
      scheduleTournamentScoresSaveV92('setScoreById');
      return out;
    };
  }

  const previousResetScores = window.resetScores;
  if(typeof previousResetScores === 'function'){
    window.resetScores = function(){
      const out = previousResetScores.apply(this, arguments);
      scheduleTournamentScoresSaveV92('resetScores');
      return out;
    };
  }

  const previousSave = window.save;
  window.save = async function(){
    if(typeof previousSave === 'function') await previousSave.apply(this, arguments);
    await saveTournamentScoresRelationalV92(false);
  };

  setTimeout(async function(){
    try{
      if(typeof currentUser === 'function' && currentUser()){
        const loaded = await loadTournamentScoresRelationalV92();
        if(loaded && typeof renderAll === 'function'){
          renderAll(true);
          if(typeof updateAuthChrome === 'function') updateAuthChrome();
          if(typeof enforceCurrentAccess === 'function') enforceCurrentAccess();
        }
      }
    }catch(e){
      console.warn('[TBK V92] Chargement scores relationnels impossible, mode local conservé.', e);
      log('error','scores.v92.load', e.message || String(e));
    }
  }, 3200);

  window.addEventListener('beforeunload', function(){
    try { if(typeof currentUser === 'function' && currentUser()) saveTournamentScoresRelationalV92(false); } catch(e) {}
  });
})();
