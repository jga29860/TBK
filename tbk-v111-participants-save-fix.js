/* TBK V111 - Correctif sauvegarde participants tournoi
   Objectif : ne plus dépendre uniquement de renderAll(false) / saveTournamentRelationalV91
   pour enregistrer les noms et clubs des participants du tournoi.

   A charger en dernier, après V91/V106/V107/V110.
*/
(function(){
  'use strict';

  const CFG_KEY = 'tbk_supabase_shared_config_v66';
  const TOURNAMENT_NAME = 'Tournoi TBK 2026-2027';
  const SEASON_DEFAULT = '2026-2027';
  let clientCache = null;
  let saveTimer = null;
  let pending = new Map();

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

  async function connectDb(){
    const c = cfg();
    const client = sb();
    if(!client) throw new Error('Supabase non configuré');
    if(!c.dbEmail || !c.dbPassword) throw new Error('Compte technique Supabase incomplet');
    const session = await client.auth.getSession();
    if(session && session.data && session.data.session && session.data.session.user && session.data.session.user.email === c.dbEmail){
      return session.data.session.user;
    }
    await client.auth.signOut();
    const { data, error } = await client.auth.signInWithPassword({ email:c.dbEmail, password:c.dbPassword });
    if(error) throw error;
    return data.user;
  }

  function log(type, detail){
    try { console.log('[TBK V111 participants]', type, detail || ''); } catch(e) {}
    try { if(window.tbkDebugLog) window.tbkDebugLog('participants.v111.' + type, detail || {}); } catch(e) {}
  }

  function clean(v){ return String(v == null ? '' : v).trim(); }

  function getLocalTeam(key, teamNumber){
    try { return window.state && state[key] && state[key].teams ? state[key].teams[teamNumber] : null; } catch(e) { return null; }
  }

  function updateLocalTeam(key, teamNumber, field, value){
    const team = getLocalTeam(key, teamNumber);
    if(!team) return;
    if(typeof window.ensureParticipantClubs === 'function') window.ensureParticipantClubs(team);
    team[field] = value;
    if(field === 'club1' || field === 'club2'){
      if(typeof window.syncLegacyClub === 'function') window.syncLegacyClub(team);
      else {
        const vals = [team.club1, team.club2].map(clean).filter(Boolean);
        team.club = Array.from(new Set(vals)).join(' / ');
      }
    }
    try { if(typeof STORAGE !== 'undefined') localStorage.setItem(STORAGE, JSON.stringify(state)); } catch(e) {}
  }

  function fieldToPlayer(field){
    if(field === 'j1') return { player_order:1, column:'player_name' };
    if(field === 'j2') return { player_order:2, column:'player_name' };
    if(field === 'club1') return { player_order:1, column:'club_name' };
    if(field === 'club2') return { player_order:2, column:'club_name' };
    return null;
  }

  function queueSave(key, teamNumber, field, value){
    const info = fieldToPlayer(field);
    if(!info) return;
    const mapKey = [key, Number(teamNumber), info.player_order, info.column].join(':');
    pending.set(mapKey, { competition_key:key, team_number:Number(teamNumber), player_order:info.player_order, column:info.column, value:clean(value) });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSaves, 250);
  }

  async function getTournament(){
    const client = sb();
    const c = cfg();
    const seasonRes = await client.from('club_seasons').select('id,label').eq('label', c.seasonLabel).maybeSingle();
    if(seasonRes.error) throw seasonRes.error;
    if(!seasonRes.data) throw new Error('Saison introuvable : ' + c.seasonLabel);
    const tournamentRes = await client.from('tournaments').select('id,name').eq('season_id', seasonRes.data.id).eq('name', TOURNAMENT_NAME).maybeSingle();
    if(tournamentRes.error) throw tournamentRes.error;
    if(!tournamentRes.data) throw new Error('Tournoi introuvable : ' + TOURNAMENT_NAME);
    return tournamentRes.data;
  }

  async function resolvePlayerRow(tournamentId, competitionKey, teamNumber, playerOrder){
    const client = sb();
    const compRes = await client.from('tournament_competitions').select('id').eq('tournament_id', tournamentId).eq('competition_key', competitionKey).maybeSingle();
    if(compRes.error) throw compRes.error;
    if(!compRes.data) throw new Error('Compétition introuvable : ' + competitionKey);

    const teamRes = await client.from('tournament_teams').select('id').eq('competition_id', compRes.data.id).eq('team_number', teamNumber).maybeSingle();
    if(teamRes.error) throw teamRes.error;
    if(!teamRes.data) throw new Error('Equipe introuvable : ' + competitionKey + '-' + teamNumber);

    const playerRes = await client.from('tournament_team_players').select('id,team_id,player_order').eq('team_id', teamRes.data.id).eq('player_order', playerOrder).maybeSingle();
    if(playerRes.error) throw playerRes.error;
    if(playerRes.data) return playerRes.data;

    const ins = await client.from('tournament_team_players')
      .insert({ team_id:teamRes.data.id, player_order:playerOrder, player_name:'', club_name:'' })
      .select('id,team_id,player_order')
      .maybeSingle();
    if(ins.error) throw ins.error;

    // Crée aussi la ligne d'émargement si elle manque.
    await client.from('tournament_checkins').upsert({ team_player_id:ins.data.id, present:false, absent:true, paid:false }, { onConflict:'team_player_id' });
    return ins.data;
  }

  async function flushSaves(){
    const batch = Array.from(pending.values());
    pending.clear();
    if(!batch.length) return;
    try{
      await connectDb();
      const tournament = await getTournament();
      for(const item of batch){
        const row = await resolvePlayerRow(tournament.id, item.competition_key, item.team_number, item.player_order);
        const updates = { updated_at:new Date().toISOString() };
        updates[item.column] = item.value;
        const res = await sb().from('tournament_team_players').update(updates).eq('id', row.id);
        if(res.error) throw res.error;
      }
      log('save.ok', { count:batch.length });
      if(typeof window.tbkSetRealtimeBadge === 'function') window.tbkSetRealtimeBadge('ok', '🟢 Participants sauvegardés');
    } catch(e){
      console.error('[TBK V111] Erreur sauvegarde participant tournoi', e);
      log('save.error', { error:e.message || String(e), batch });
      if(typeof window.tbkSetRealtimeBadge === 'function') window.tbkSetRealtimeBadge('error', '⚠ Participants non sauvegardés');
    }
  }

  function installWrappers(){
    if(window.__tbkV111ParticipantSaveInstalled) return;
    window.__tbkV111ParticipantSaveInstalled = true;

    const oldEditFromEmargement = window.editTeamFromEmargement;
    window.editTeamFromEmargement = function(key, id, field, value){
      let r;
      if(typeof oldEditFromEmargement === 'function') r = oldEditFromEmargement.apply(this, arguments);
      else updateLocalTeam(key, id, field, value);
      updateLocalTeam(key, id, field, value);
      queueSave(key, id, field, value);
      return r;
    };

    const oldTeamEdit = window.teamEdit;
    window.teamEdit = function(key, id, field, value){
      let r;
      if(typeof oldTeamEdit === 'function') r = oldTeamEdit.apply(this, arguments);
      else updateLocalTeam(key, id, field, value);
      updateLocalTeam(key, id, field, value);
      queueSave(key, id, field, value);
      return r;
    };

    log('installed', { wrappers:['editTeamFromEmargement','teamEdit'] });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWrappers);
  else installWrappers();
  setTimeout(installWrappers, 1000);

  window.tbkV111ParticipantsDiagnostic = function(){
    return {
      installed: !!window.__tbkV111ParticipantSaveInstalled,
      pending: pending.size,
      supabaseConfigured: !!sb(),
      hasEditTeamFromEmargement: typeof window.editTeamFromEmargement === 'function',
      hasTeamEdit: typeof window.teamEdit === 'function'
    };
  };
})();
