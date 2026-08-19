/* TBK V91 - Gestion Tournoi relationnelle Supabase
   Objectif : brancher progressivement le module Gestion Tournoi sur les tables tournament_*.
   Mode non destructif :
   - si la base est vide et que le navigateur contient deja des donnees tournoi, les donnees locales sont conservees et poussees vers Supabase ;
   - sinon les equipes, joueurs, clubs, emargement et parametres sont recharges depuis Supabase ;
   - les matchs/scores/planning restent geres par le moteur existant pour eviter toute regression.
*/
(function(){
  const CFG_KEY = 'tbk_supabase_shared_config_v66';
  const TOURNAMENT_NAME = 'Tournoi TBK 2026-2027';
  const SAVE_DELAY_MS = 900;

  let clientCache = null;
  let dbUser = null;
  let dbSeason = null;
  let dbTournament = null;
  let dbCompetitions = {};
  let dbPoolsByKey = { dm:{}, dh:{} };
  let dbTeamsByNumber = { dm:{}, dh:{} };
  let dbPlayersByTeamNumber = { dm:{}, dh:{} };
  let v91SaveTimer = null;
  let v91Saving = false;
  let v91Pending = false;
  let hasLoadedOnce = false;
  let applyingRemote = false;

  function log(level, step, detail){
    if(typeof tbkDebugLog === 'function') tbkDebugLog(level, step, detail);
    try { console.log('[TBK V91]', step, detail || ''); } catch(e) {}
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

  function hasLocalTournamentData(){
    try{
      const keys = ['dm','dh'];
      for(const key of keys){
        const comp = state && state[key];
        if(!comp || !comp.teams) continue;
        for(const t of Object.values(comp.teams)){
          if([t.j1,t.j2,t.club,t.club1,t.club2].some(v => String(v || '').trim())) return true;
        }
        if((comp.matches || []).some(m => m.done || (m.scores || []).some(s => Number.isFinite(s[0]) || Number.isFinite(s[1])))) return true;
        if((comp.ko || []).some(m => m.done || (m.scores || []).some(s => Number.isFinite(s[0]) || Number.isFinite(s[1])))) return true;
      }
      for(const key of keys){
        const chk = state && state.checkin && state.checkin[key] ? state.checkin[key] : {};
        for(const c of Object.values(chk)){
          if(c.present1 || c.present2 || c.paid1 || c.paid2 || c.absent1 === false || c.absent2 === false) return true;
        }
      }
    }catch(e){ return true; }
    return false;
  }

  function remoteHasTournamentData(players, checkins, matches){
    return (players || []).some(p => String(p.player_name || '').trim() || String(p.club_name || '').trim()) ||
      (checkins || []).some(c => c.present || c.paid || c.absent === false) ||
      (matches || []).some(m => m.done || m.started_at || m.ended_at || m.winner_team_id);
  }

  function ensureCompState(){
    state.dm = state.dm || {name:'Double Mixte',prefix:'DM',teamCount:32,pools:['A','B','C','D','E','F','G','H'],teams:{},matches:[],ko:[]};
    state.dh = state.dh || {name:'Double Homme',prefix:'DH',teamCount:16,pools:['A','B','C','D'],teams:{},matches:[],ko:[]};
    state.checkin = state.checkin || {dm:{},dh:{}};
    state.checkin.dm = state.checkin.dm || {};
    state.checkin.dh = state.checkin.dh || {};
  }

  function syncLegacyClubLocal(t){
    if(!t) return;
    const vals = [t.club1,t.club2].map(x => String(x || '').trim()).filter(Boolean);
    t.club = [...new Set(vals)].join(' / ');
  }

  function emptyScores(compKey){
    const comp = state[compKey];
    return [...(comp.matches || []), ...(comp.ko || [])].every(m => !m.done && (m.scores || []).every(s => !Number.isFinite(s[0]) && !Number.isFinite(s[1])));
  }

  function rebuildMatchesIfSafe(compKey){
    if(!emptyScores(compKey)) return;
    if(compKey === 'dm'){
      state.dm.matches = typeof makePoolMatches === 'function' ? makePoolMatches('dm', 1, state) : state.dm.matches;
      state.dm.ko = typeof makeDMKO === 'function' ? makeDMKO() : state.dm.ko;
    } else {
      state.dh.matches = typeof makePoolMatches === 'function' ? makePoolMatches('dh', 100, state) : state.dh.matches;
      state.dh.ko = typeof makeDHKO === 'function' ? makeDHKO() : state.dh.ko;
    }
  }

  async function ensureTournamentStructure(){
    const client = sb();
    const season = await getSeason();
    let res = await client.from('tournaments').select('*').eq('season_id', season.id).eq('name', TOURNAMENT_NAME).maybeSingle();
    if(res.error) throw res.error;
    if(!res.data){
      const ins = await client.from('tournaments').insert({
        season_id: season.id,
        name: TOURNAMENT_NAME,
        start_time: (state?.settings?.start || '20:00'),
        rotation_minutes: Number(state?.settings?.rotation || 20),
        courts_count: Number(state?.settings?.courts || 9),
        participant_fee: Number(state?.settings?.participantFee || 0),
        min_rest_between_matches: Number(state?.settings?.minRestBetweenMatches || 0),
        active: true
      }).select('*').maybeSingle();
      if(ins.error) throw ins.error;
      res.data = ins.data;
    }
    dbTournament = res.data;
    return dbTournament;
  }

  async function loadTournamentRows(){
    const client = sb();
    await connectDb();
    const tournament = await ensureTournamentStructure();

    const compsRes = await client.from('tournament_competitions').select('*').eq('tournament_id', tournament.id).eq('active', true).order('sort_order', { ascending:true });
    if(compsRes.error) throw compsRes.error;
    dbCompetitions = {};
    (compsRes.data || []).forEach(c => { dbCompetitions[c.competition_key] = c; });

    const compIds = (compsRes.data || []).map(c => c.id);
    if(!compIds.length) throw new Error('Aucune compétition tournoi trouvée en base.');

    const poolsRes = await client.from('tournament_pools').select('*').in('competition_id', compIds).order('sort_order', { ascending:true });
    if(poolsRes.error) throw poolsRes.error;

    dbPoolsByKey = { dm:{}, dh:{} };
    (poolsRes.data || []).forEach(p => {
      const comp = (compsRes.data || []).find(c => c.id === p.competition_id);
      if(comp) dbPoolsByKey[comp.competition_key][p.pool_key] = p;
    });

    const teamsRes = await client.from('tournament_teams').select('*').in('competition_id', compIds).eq('active', true).order('team_number', { ascending:true });
    if(teamsRes.error) throw teamsRes.error;
    const teamIds = (teamsRes.data || []).map(t => t.id);

    const playersRes = teamIds.length ? await client.from('tournament_team_players').select('*').in('team_id', teamIds).order('player_order', { ascending:true }) : {data:[], error:null};
    if(playersRes.error) throw playersRes.error;

    const playerIds = (playersRes.data || []).map(p => p.id);
    const checkinsRes = playerIds.length ? await client.from('tournament_checkins').select('*').in('team_player_id', playerIds) : {data:[], error:null};
    if(checkinsRes.error) throw checkinsRes.error;

    const matchesRes = await client.from('tournament_matches').select('id,done,started_at,ended_at,winner_team_id').in('competition_id', compIds).limit(1000);
    if(matchesRes.error) throw matchesRes.error;

    return {
      tournament,
      competitions: compsRes.data || [],
      pools: poolsRes.data || [],
      teams: teamsRes.data || [],
      players: playersRes.data || [],
      checkins: checkinsRes.data || [],
      matches: matchesRes.data || []
    };
  }

  function indexRows(rows){
    dbTeamsByNumber = { dm:{}, dh:{} };
    dbPlayersByTeamNumber = { dm:{}, dh:{} };
    const playersByTeam = {};
    (rows.players || []).forEach(p => {
      playersByTeam[p.team_id] = playersByTeam[p.team_id] || {};
      playersByTeam[p.team_id][p.player_order] = p;
    });
    (rows.teams || []).forEach(t => {
      const comp = (rows.competitions || []).find(c => c.id === t.competition_id);
      if(!comp) return;
      const key = comp.competition_key;
      dbTeamsByNumber[key][t.team_number] = t;
      dbPlayersByTeamNumber[key][t.team_number] = playersByTeam[t.id] || {};
    });
  }

  function applyRowsToState(rows){
    ensureCompState();
    applyingRemote = true;
    try{
      const t = rows.tournament;
      state.settings = state.settings || {};
      if(t.start_time) state.settings.start = String(t.start_time).slice(0,5);
      state.settings.rotation = Number(t.rotation_minutes || state.settings.rotation || 20);
      state.settings.courts = Number(t.courts_count || state.settings.courts || 9);
      state.settings.participantFee = Number(t.participant_fee || state.settings.participantFee || 0);
      state.settings.minRestBetweenMatches = Number(t.min_rest_between_matches || state.settings.minRestBetweenMatches || 0);

      for(const key of ['dm','dh']){
        const compRow = dbCompetitions[key];
        if(!compRow) continue;
        const poolRows = (rows.pools || []).filter(p => p.competition_id === compRow.id).sort((a,b) => (a.sort_order || 0) - (b.sort_order || 0));
        const teamRows = (rows.teams || []).filter(team => team.competition_id === compRow.id).sort((a,b) => a.team_number - b.team_number);
        state[key].pools = poolRows.map(p => p.pool_key);
        state[key].poolsFrozen = !!compRow.pools_frozen;
        state[key].teamCount = compRow.team_count || state[key].teamCount;
        state[key].prefix = compRow.prefix || state[key].prefix;
        state[key].name = compRow.name || state[key].name;
        state[key].teams = {};
        state.checkin[key] = {};

        teamRows.forEach(team => {
          const pool = poolRows.find(p => p.id === team.pool_id);
          const players = dbPlayersByTeamNumber[key][team.team_number] || {};
          const p1 = players[1] || {};
          const p2 = players[2] || {};
          const localTeam = {
            id: team.team_number,
            pool: pool ? pool.pool_key : '',
            pos: team.pool_rank || 1,
            j1: p1.player_name || '',
            j2: p2.player_name || '',
            club1: p1.club_name || '',
            club2: p2.club_name || '',
            waitResetAt: team.wait_reset_at ? new Date(team.wait_reset_at).getTime() : undefined
          };
          syncLegacyClubLocal(localTeam);
          state[key].teams[team.team_number] = localTeam;

          const c1 = (rows.checkins || []).find(c => c.team_player_id === p1.id) || {};
          const c2 = (rows.checkins || []).find(c => c.team_player_id === p2.id) || {};
          state.checkin[key][team.team_number] = {
            present1: !!c1.present,
            absent1: c1.absent !== false,
            paid1: !!c1.paid,
            present2: !!c2.present,
            absent2: c2.absent !== false,
            paid2: !!c2.paid
          };
        });
        rebuildMatchesIfSafe(key);
      }
      try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch(e) {}
    } finally {
      applyingRemote = false;
    }
  }

  async function loadTournamentRelationalV91(){
    const client = sb();
    if(!client) return false;
    const rows = await loadTournamentRows();
    indexRows(rows);
    const hasRemote = remoteHasTournamentData(rows.players, rows.checkins, rows.matches);
    const hasLocal = hasLocalTournamentData();
    if(!hasRemote && hasLocal){
      log('warn','tournament.v91.load','Base tournoi initialisee mais vide : conservation des donnees locales puis sauvegarde vers Supabase.');
      await saveTournamentRelationalV91(false);
      hasLoadedOnce = true;
      return false;
    }
    applyRowsToState(rows);
    hasLoadedOnce = true;
    log('ok','tournament.v91.load',{ teams: rows.teams.length, players: rows.players.length, checkins: rows.checkins.length, source:'Supabase relationnel' });
    return true;
  }

  function teamToPlayerRows(key, teamNumber){
    const team = state[key].teams[teamNumber];
    const playerMap = dbPlayersByTeamNumber[key][teamNumber] || {};
    const p1 = playerMap[1];
    const p2 = playerMap[2];
    const arr = [];
    if(p1) arr.push({ id:p1.id, player_name: team.j1 || '', club_name: team.club1 || team.club || '', updated_at:new Date().toISOString() });
    if(p2) arr.push({ id:p2.id, player_name: team.j2 || '', club_name: team.club2 || team.club || '', updated_at:new Date().toISOString() });
    return arr;
  }

  async function ensureDbMapReady(forceReload){
    if(!forceReload && dbTournament && Object.keys(dbCompetitions).length && (Object.keys(dbTeamsByNumber.dm).length || Object.keys(dbTeamsByNumber.dh).length)) return;
    const rows = await loadTournamentRows();
    indexRows(rows);
  }

  async function saveTournamentRelationalV91(showMessage){
    if(applyingRemote) return false;
    if(!currentUser || !currentUser()) return false;
    const client = sb();
    if(!client){ if(showMessage) alert('Supabase non configuré.'); return false; }
    if(v91Saving){ v91Pending = true; return false; }
    v91Saving = true;
    try{
      await connectDb();
      await ensureDbMapReady(true);
      const now = new Date().toISOString();

      if(dbTournament){
        const updTournament = await client.from('tournaments').update({
          start_time: state.settings?.start || '20:00',
          rotation_minutes: Number(state.settings?.rotation || 20),
          courts_count: Number(state.settings?.courts || 9),
          participant_fee: Number(state.settings?.participantFee || 0),
          min_rest_between_matches: Number(state.settings?.minRestBetweenMatches || 0),
          updated_at: now
        }).eq('id', dbTournament.id);
        if(updTournament.error) throw updTournament.error;
      }

      for(const key of ['dm','dh']){
        const comp = dbCompetitions[key];
        if(!comp) continue;
        const updComp = await client.from('tournament_competitions').update({
          pools_frozen: !!state[key].poolsFrozen,
          updated_at: now
        }).eq('id', comp.id);
        if(updComp.error) throw updComp.error;

        const teamUpdates = [];
        const playerUpdates = [];
        const checkinUpdates = [];
        for(const [teamNumberRaw, team] of Object.entries(state[key].teams || {})){
          const teamNumber = Number(teamNumberRaw);
          const dbTeam = dbTeamsByNumber[key][teamNumber];
          if(!dbTeam) continue;
          const pool = dbPoolsByKey[key][team.pool];
          teamUpdates.push({
            id: dbTeam.id,
            competition_id: comp.id,
            team_number: teamNumber,
            team_code: dbTeam.team_code || (String(key).toUpperCase() + '-' + String(teamNumber).padStart(2, '0')),
            active: true,
            pool_id: pool ? pool.id : dbTeam.pool_id,
            pool_rank: Number(team.pos || dbTeam.pool_rank || 1),
            wait_reset_at: team.waitResetAt ? new Date(team.waitResetAt).toISOString() : null,
            updated_at: now
          });
          playerUpdates.push(...teamToPlayerRows(key, teamNumber));
          const c = state.checkin && state.checkin[key] ? state.checkin[key][teamNumber] : null;
          const playerMap = dbPlayersByTeamNumber[key][teamNumber] || {};
          if(c && playerMap[1]) checkinUpdates.push({ team_player_id: playerMap[1].id, present:!!c.present1, absent:!!c.absent1, paid:!!c.paid1, updated_by: dbUser?.id || null, updated_at: now });
          if(c && playerMap[2]) checkinUpdates.push({ team_player_id: playerMap[2].id, present:!!c.present2, absent:!!c.absent2, paid:!!c.paid2, updated_by: dbUser?.id || null, updated_at: now });
        }

        if(teamUpdates.length){
          for(const row of teamUpdates){
            const { id, ...updates } = row;
            const res = await client.from('tournament_teams').update(updates).eq('id', id);
            if(res.error) throw res.error;
          }
        }
        if(playerUpdates.length){
          for(const row of playerUpdates){
            const { id, ...updates } = row;
            if(!id) continue;
            const res = await client.from('tournament_team_players').update(updates).eq('id', id);
            if(res.error) throw res.error;
          }
        }
        if(checkinUpdates.length){
          for(const row of checkinUpdates){
            const { team_player_id, ...updates } = row;
            if(!team_player_id) continue;
            const res = await client.from('tournament_checkins').update(updates).eq('team_player_id', team_player_id);
            if(res.error) throw res.error;
          }
        }
      }

      await saveTournamentSnapshotV91(false);
      log('ok','tournament.v91.save',{ mode:'socle relationnel', savedAt: now });
      if(showMessage) alert('Données tournoi sauvegardées dans les tables relationnelles Supabase.');
      return true;
    } catch(e){
      console.error('[TBK V91] Erreur sauvegarde tournoi relationnel', e);
      log('error','tournament.v91.save', e.message || String(e));
      if(showMessage) alert('Erreur sauvegarde tournoi relationnelle : ' + (e.message || e));
      return false;
    } finally {
      v91Saving = false;
      if(v91Pending){ v91Pending = false; scheduleTournamentRelationalSaveV91('pending'); }
    }
  }

  async function saveTournamentSnapshotV91(showMessage){
    const client = sb();
    if(!client || !dbTournament) return false;
    const payload = {
      appVersion: 'V91',
      savedAt: new Date().toISOString(),
      savedBySiteUser: typeof currentUser === 'function' ? currentUser() : null,
      settings: state.settings,
      dm: state.dm,
      dh: state.dh,
      checkin: state.checkin
    };
    const existing = await client.from('tournament_state_snapshots')
      .select('id')
      .eq('tournament_id', dbTournament.id)
      .eq('snapshot_name', 'current_tournament_state')
      .order('created_at', { ascending:false })
      .limit(1);
    if(existing.error) throw existing.error;
    if(existing.data && existing.data.length){
      const up = await client.from('tournament_state_snapshots').update({ data_json: payload }).eq('id', existing.data[0].id);
      if(up.error) throw up.error;
    } else {
      const ins = await client.from('tournament_state_snapshots').insert({ tournament_id: dbTournament.id, snapshot_name:'current_tournament_state', data_json: payload, created_by: dbUser?.id || null });
      if(ins.error) throw ins.error;
    }
    if(showMessage) alert('Snapshot tournoi de secours sauvegardé.');
    return true;
  }

  function scheduleTournamentRelationalSaveV91(reason){
    if(applyingRemote) return;
    if(!currentUser || !currentUser()) return;
    clearTimeout(v91SaveTimer);
    v91SaveTimer = setTimeout(function(){ saveTournamentRelationalV91(false); }, SAVE_DELAY_MS);
    log('info','tournament.v91.save.scheduled',{ reason: reason || 'unknown' });
  }

  window.loadTournamentRelationalV91 = loadTournamentRelationalV91;
  window.saveTournamentRelationalV91 = saveTournamentRelationalV91;
  window.saveTournamentSnapshotV91 = saveTournamentSnapshotV91;
  window.scheduleTournamentRelationalSaveV91 = scheduleTournamentRelationalSaveV91;

  const previousRenderAll = window.renderAll;
  if(typeof previousRenderAll === 'function'){
    window.renderAll = function(skipSave){
      const result = previousRenderAll.apply(this, arguments);
      if(!skipSave) scheduleTournamentRelationalSaveV91('renderAll');
      return result;
    };
  }

  const previousSave = window.save;
  window.save = async function(){
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch(e) {}
    await saveTournamentRelationalV91(true);
    if(typeof previousSave === 'function') await previousSave.apply(this, arguments);
  };

  // Chargement apres authentification : non destructif.
  setTimeout(async function(){
    try{
      if(typeof currentUser === 'function' && currentUser()){
        const loaded = await loadTournamentRelationalV91();
        if(loaded && typeof renderAll === 'function'){
          renderAll(true);
          if(typeof updateAuthChrome === 'function') updateAuthChrome();
          if(typeof enforceCurrentAccess === 'function') enforceCurrentAccess();
        }
      }
    }catch(e){
      console.warn('[TBK V91] Chargement tournoi relationnel impossible, fallback local conserve.', e);
      log('error','tournament.v91.load', e.message || String(e));
    }
  }, 2300);

  window.addEventListener('beforeunload', function(){
    try { if(typeof currentUser === 'function' && currentUser()) saveTournamentRelationalV91(false); } catch(e) {}
  });
})();
