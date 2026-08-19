/* TBK V93 - Planning et terrains relationnels Supabase
   Objectif : persister l'affectation des terrains, l'heure de lancement et la liberation terrain.
   Tables utilisees : tournament_courts, tournament_court_assignments, tournament_matches.
   Mode prudent : le moteur actuel de planning reste la reference d'affichage, Supabase sert de persistance partagee.
*/
(function(){
  const CFG_KEY = 'tbk_supabase_shared_config_v66';
  const TOURNAMENT_NAME = 'Tournoi TBK 2026-2027';
  const SAVE_DELAY_MS = 650;

  let clientCache = null;
  let dbUser = null;
  let dbSeason = null;
  let dbTournament = null;
  let dbCompetitions = {};
  let dbMatchesByKey = { dm:{}, dh:{} };
  let dbCourtsByNumber = {};
  let loadingRemote = false;
  let saving = false;
  let pending = false;
  let saveTimer = null;

  function log(level, step, detail){
    if(typeof tbkDebugLog === 'function') tbkDebugLog(level, step, detail);
    try { console.log('[TBK V93]', step, detail || ''); } catch(e) {}
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

  function matchNumber(m){ return Number(m.id ?? m.n ?? m.match_number); }

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

    const comps = await client.from('tournament_competitions').select('*').eq('tournament_id', dbTournament.id).eq('active', true);
    if(comps.error) throw comps.error;
    dbCompetitions = {};
    (comps.data || []).forEach(c => { dbCompetitions[c.competition_key] = c; });
    const compIds = (comps.data || []).map(c => c.id);
    if(!compIds.length) throw new Error('Aucune compétition tournoi trouvée.');

    // S'assurer que les terrains existent jusqu'au nombre parametre.
    await ensureCourts();

    const courts = await client.from('tournament_courts').select('*').eq('tournament_id', dbTournament.id).order('court_number', {ascending:true});
    if(courts.error) throw courts.error;
    dbCourtsByNumber = {};
    (courts.data || []).forEach(c => { dbCourtsByNumber[c.court_number] = c; });

    const matches = await client.from('tournament_matches').select('id,competition_id,match_number').in('competition_id', compIds).limit(1000);
    if(matches.error) throw matches.error;
    rebuildDbMatchMap(matches.data || []);
    return compIds;
  }

  function rebuildDbMatchMap(rows){
    dbMatchesByKey = { dm:{}, dh:{} };
    const compById = {};
    Object.entries(dbCompetitions).forEach(([key, comp]) => { compById[comp.id] = key; });
    (rows || []).forEach(r => {
      const key = compById[r.competition_id];
      if(key) dbMatchesByKey[key][r.match_number] = r;
    });
  }

  async function ensureCourts(){
    const client = sb();
    if(!dbTournament) return;
    const count = Math.max(1, Number(state?.settings?.courts || dbTournament.courts_count || 9));
    const rows = [];
    for(let i=1;i<=count;i++) rows.push({ tournament_id:dbTournament.id, court_number:i, label:'Terrain '+i, active:true });
    const up = await client.from('tournament_courts').upsert(rows, { onConflict:'tournament_id,court_number' });
    if(up.error) throw up.error;
    // Desactiver les terrains au-dela du parametrage sans les supprimer.
    const disable = await client.from('tournament_courts').update({ active:false }).eq('tournament_id', dbTournament.id).gt('court_number', count);
    if(disable.error) log('warn','planning.v93.courts.disable',disable.error.message);
  }

  function localHasCourtAssignments(){
    return allLocalMatches().some(m => Number.isFinite(m.manualCourt) || Number.isFinite(m.court) || m.startedAt || m.endedAt);
  }

  function remoteHasAssignments(rows){
    return (rows || []).some(a => a.court_id || a.assigned_at || a.released_at);
  }

  async function loadAssignments(){
    const client = sb();
    await ensureMetadata();
    const matchIds = [];
    Object.values(dbMatchesByKey.dm).forEach(m => matchIds.push(m.id));
    Object.values(dbMatchesByKey.dh).forEach(m => matchIds.push(m.id));
    if(!matchIds.length) return [];
    const res = await client.from('tournament_court_assignments').select('*').in('match_id', matchIds);
    if(res.error) throw res.error;
    return res.data || [];
  }

  function applyAssignmentsToState(assignments){
    const matchById = {};
    for(const [key, map] of Object.entries(dbMatchesByKey)) Object.values(map).forEach(m => { matchById[m.id] = {key, row:m}; });
    const courtById = {};
    Object.values(dbCourtsByNumber).forEach(c => { courtById[c.id] = c; });
    loadingRemote = true;
    try{
      for(const a of assignments || []){
        const ref = matchById[a.match_id];
        if(!ref) continue;
        const local = allLocalMatches().find(m => m.comp === ref.key && matchNumber(m) === ref.row.match_number);
        if(!local) continue;
        const court = courtById[a.court_id];
        if(!court) continue;
        local.manualCourt = court.court_number;
        local.court = court.court_number;
        if(a.assigned_at) local.startedAt = new Date(a.assigned_at).getTime();
        if(a.released_at) local.endedAt = new Date(a.released_at).getTime();
      }
      try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch(e) {}
    } finally { loadingRemote = false; }
  }

  async function loadTournamentPlanningRelationalV93(){
    const client = sb();
    if(!client) return false;
    await connectDb();
    const assignments = await loadAssignments();
    const hasRemote = remoteHasAssignments(assignments);
    const hasLocal = localHasCourtAssignments();
    if(!hasRemote && hasLocal){
      log('warn','planning.v93.load','Aucune affectation Supabase : conservation du planning local puis sauvegarde.');
      await saveTournamentPlanningRelationalV93(false);
      return false;
    }
    if(hasRemote){
      applyAssignmentsToState(assignments);
      log('ok','planning.v93.load',{ assignments: assignments.length, source:'Supabase relationnel' });
      return true;
    }
    log('ok','planning.v93.load','Aucune affectation terrain à appliquer.');
    return false;
  }

  function desiredAssignmentFor(m){
    const courtNumber = Number.isFinite(m.manualCourt) ? m.manualCourt : (Number.isFinite(m.court) ? m.court : null);
    if(!Number.isFinite(courtNumber)) return null;
    const dbMatch = dbMatchesByKey[m.comp] ? dbMatchesByKey[m.comp][matchNumber(m)] : null;
    const dbCourt = dbCourtsByNumber[courtNumber];
    if(!dbMatch || !dbCourt) return null;
    return {
      match_id: dbMatch.id,
      court_id: dbCourt.id,
      assigned_at: m.startedAt ? new Date(m.startedAt).toISOString() : new Date().toISOString(),
      released_at: m.done ? (m.endedAt ? new Date(m.endedAt).toISOString() : new Date().toISOString()) : (m.endedAt ? new Date(m.endedAt).toISOString() : null),
      assigned_by: dbUser?.id || null,
      manual: true,
      updated_at: new Date().toISOString()
    };
  }

  async function saveTournamentPlanningRelationalV93(showMessage){
    if(loadingRemote) return false;
    if(!currentUser || !currentUser()) return false;
    const client = sb();
    if(!client){ if(showMessage) alert('Supabase non configuré.'); return false; }
    if(saving){ pending = true; return false; }
    saving = true;
    try{
      await connectDb();
      await ensureMetadata();

      // Mettre aussi à jour le nombre de terrains dans tournaments, car il pilote ensureCourts.
      if(dbTournament){
        const upTournament = await client.from('tournaments').update({
          courts_count: Number(state?.settings?.courts || 9),
          min_rest_between_matches: Number(state?.settings?.minRestBetweenMatches || 0),
          updated_at: new Date().toISOString()
        }).eq('id', dbTournament.id);
        if(upTournament.error) throw upTournament.error;
      }

      const assignments = [];
      const assignedMatchIds = new Set();
      for(const m of allLocalMatches()){
        const row = desiredAssignmentFor(m);
        if(row){
          assignments.push(row);
          assignedMatchIds.add(row.match_id);
        }
      }

      if(assignments.length){
        const up = await client.from('tournament_court_assignments').upsert(assignments, { onConflict:'match_id' });
        if(up.error) throw up.error;
      }

      // Supprimer les affectations des matchs non termines qui n'ont plus de terrain local.
      const allDbMatchIds = [];
      Object.values(dbMatchesByKey.dm).forEach(m => allDbMatchIds.push(m.id));
      Object.values(dbMatchesByKey.dh).forEach(m => allDbMatchIds.push(m.id));
      const toDelete = [];
      for(const m of allLocalMatches()){
        const dbMatch = dbMatchesByKey[m.comp] ? dbMatchesByKey[m.comp][matchNumber(m)] : null;
        if(!dbMatch) continue;
        const hasCourt = Number.isFinite(m.manualCourt) || Number.isFinite(m.court);
        if(!hasCourt && !m.done) toDelete.push(dbMatch.id);
      }
      if(toDelete.length){
        const del = await client.from('tournament_court_assignments').delete().in('match_id', toDelete);
        if(del.error) throw del.error;
      }

      log('ok','planning.v93.save',{ assignments: assignments.length, deleted: toDelete.length });
      if(showMessage) alert('Planning et terrains sauvegardés dans Supabase.');
      return true;
    }catch(e){
      console.error('[TBK V93] Erreur sauvegarde planning', e);
      log('error','planning.v93.save', e.message || String(e));
      if(showMessage) alert('Erreur sauvegarde planning Supabase : ' + (e.message || e));
      return false;
    }finally{
      saving = false;
      if(pending){ pending = false; scheduleTournamentPlanningSaveV93('pending'); }
    }
  }

  function scheduleTournamentPlanningSaveV93(reason){
    if(loadingRemote) return;
    if(!currentUser || !currentUser()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){ saveTournamentPlanningRelationalV93(false); }, SAVE_DELAY_MS);
    log('info','planning.v93.save.scheduled',{ reason: reason || 'unknown' });
  }

  window.loadTournamentPlanningRelationalV93 = loadTournamentPlanningRelationalV93;
  window.saveTournamentPlanningRelationalV93 = saveTournamentPlanningRelationalV93;
  window.scheduleTournamentPlanningSaveV93 = scheduleTournamentPlanningSaveV93;

  const previousAssignCourtFromPanel = window.assignCourtFromPanel;
  if(typeof previousAssignCourtFromPanel === 'function'){
    window.assignCourtFromPanel = function(){
      const out = previousAssignCourtFromPanel.apply(this, arguments);
      scheduleTournamentPlanningSaveV93('assignCourtFromPanel');
      return out;
    };
  }

  const previousClearCourtSelection = window.clearCourtSelection;
  if(typeof previousClearCourtSelection === 'function'){
    window.clearCourtSelection = function(){
      const out = previousClearCourtSelection.apply(this, arguments);
      scheduleTournamentPlanningSaveV93('clearCourtSelection');
      return out;
    };
  }

  const previousSetScoreById = window.setScoreById;
  if(typeof previousSetScoreById === 'function'){
    window.setScoreById = function(){
      const out = previousSetScoreById.apply(this, arguments);
      scheduleTournamentPlanningSaveV93('setScoreById');
      return out;
    };
  }

  const previousCheckEdit = window.checkEdit;
  if(typeof previousCheckEdit === 'function'){
    window.checkEdit = function(){
      const out = previousCheckEdit.apply(this, arguments);
      scheduleTournamentPlanningSaveV93('checkEdit');
      return out;
    };
  }

  const previousSave = window.save;
  window.save = async function(){
    if(typeof previousSave === 'function') await previousSave.apply(this, arguments);
    await saveTournamentPlanningRelationalV93(false);
  };

  setTimeout(async function(){
    try{
      if(typeof currentUser === 'function' && currentUser()){
        const loaded = await loadTournamentPlanningRelationalV93();
        if(loaded && typeof renderAll === 'function'){
          renderAll(true);
          if(typeof updateAuthChrome === 'function') updateAuthChrome();
          if(typeof enforceCurrentAccess === 'function') enforceCurrentAccess();
        }
      }
    }catch(e){
      console.warn('[TBK V93] Chargement planning relationnel impossible, mode local conservé.', e);
      log('error','planning.v93.load', e.message || String(e));
    }
  }, 4300);

  window.addEventListener('beforeunload', function(){
    try { if(typeof currentUser === 'function' && currentUser()) saveTournamentPlanningRelationalV93(false); } catch(e) {}
  });
})();
