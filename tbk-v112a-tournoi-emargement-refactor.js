/*
  TBK V112A - Refactoring Emargement Tournoi
  Objectif : rendre l'enregistrement des participants, clubs et emargements cible et fiable.
  A charger en dernier dans index.html.
*/
(function(){
  'use strict';

  const VERSION = 'V112A';
  const LOG_PREFIX = '[TBK V112A Emargement]';
  const DEFAULT_SEASON = '2026-2027';
  const DEFAULT_TOURNAMENT = 'Tournoi TBK 2026-2027';
  const LOCAL_EDIT_GUARD_MS = 4500;

  if (window.TBKV112A && window.TBKV112A.__installed) {
    console.warn(LOG_PREFIX, 'deja installe');
    return;
  }

  const state = {
    __installed: true,
    version: VERSION,
    cacheLoadedAt: 0,
    season: null,
    tournament: null,
    competitionsByKey: new Map(),
    teamsByKey: new Map(),
    playersByKey: new Map(),
    checkinsByPlayerId: new Map(),
    saving: false,
    lastError: null,
    lastSaveAt: null,
    lastEditAt: 0,
    logs: []
  };

  function log(type, details){
    const entry = { at: new Date().toISOString(), type, details: details || {} };
    state.logs.push(entry);
    if (state.logs.length > 200) state.logs.shift();
    try { console.debug(LOG_PREFIX, type, details || ''); } catch(e) {}
  }

  function warn(type, details){
    const entry = { at: new Date().toISOString(), type: 'warn.' + type, details: details || {} };
    state.logs.push(entry);
    state.lastError = entry;
    try { console.warn(LOG_PREFIX, type, details || ''); } catch(e) {}
  }

  function getConfig(){
    const cfg = window.TBK_SUPABASE_CONFIG || {};
    return {
      seasonLabel: cfg.seasonLabel || cfg.season || DEFAULT_SEASON,
      tournamentName: cfg.tournamentName || cfg.tournament || DEFAULT_TOURNAMENT,
      url: cfg.url || '',
      anonKey: cfg.anonKey || ''
    };
  }

  function getSupabaseClient(){
    const candidates = [
      window.tbkSupabaseClient,
      window.TBK_SUPABASE_CLIENT,
      window.tbkSupabase,
      window.supabaseClient,
      window.TBKSupabaseClient,
      window.__tbkSupabaseClient
    ].filter(Boolean);
    for (const c of candidates) {
      if (c && typeof c.from === 'function') return c;
    }
    // Fallback : creation client si la librairie supabase est chargee et config disponible
    const cfg = getConfig();
    if (window.supabase && typeof window.supabase.createClient === 'function' && cfg.url && cfg.anonKey) {
      if (!window.__tbkV112SupabaseClient) {
        window.__tbkV112SupabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey);
      }
      return window.__tbkV112SupabaseClient;
    }
    return null;
  }

  function normalizeCompetitionKey(key){
    const v = String(key || '').trim().toLowerCase();
    if (v.includes('dh')) return 'dh';
    if (v.includes('dm')) return 'dm';
    return v;
  }

  function normalizeTeamNumber(id){
    if (typeof id === 'number') return id;
    const s = String(id || '').trim();
    const m = s.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function teamKey(competitionKey, teamNumber){
    return `${normalizeCompetitionKey(competitionKey)}:${Number(teamNumber)}`;
  }

  function playerKey(competitionKey, teamNumber, playerOrder){
    return `${normalizeCompetitionKey(competitionKey)}:${Number(teamNumber)}:${Number(playerOrder)}`;
  }

  function fieldToPlayerPatch(field, value){
    const f = String(field || '').trim();
    if (['j1','player1','player1_name','participant1','nom1'].includes(f)) return { order: 1, patch: { player_name: value } };
    if (['j2','player2','player2_name','participant2','nom2'].includes(f)) return { order: 2, patch: { player_name: value } };
    if (['club1','player1_club','club_j1','clubParticipant1'].includes(f)) return { order: 1, patch: { club_name: value } };
    if (['club2','player2_club','club_j2','clubParticipant2'].includes(f)) return { order: 2, patch: { club_name: value } };
    // Fallback ancien modele : champ club commun mis sur les deux joueurs
    if (['club','club_name'].includes(f)) return { order: 0, patch: { club_name: value } };
    return null;
  }

  function markLocalEdit(){
    state.lastEditAt = Date.now();
    window.TBK_V112A_EMARGEMENT_LOCAL_EDIT_UNTIL = Date.now() + LOCAL_EDIT_GUARD_MS;
    window.TBK_SUPPRESS_GLOBAL_AUTOSAVE_UNTIL = Math.max(window.TBK_SUPPRESS_GLOBAL_AUTOSAVE_UNTIL || 0, Date.now() + 1200);
    try { sessionStorage.setItem('tbk_v112a_last_page', 'emargement'); } catch(e) {}
  }

  async function loadContext(force){
    const now = Date.now();
    if (!force && state.cacheLoadedAt && now - state.cacheLoadedAt < 3000) return state;
    const sb = getSupabaseClient();
    if (!sb) throw new Error('Client Supabase introuvable pour V112A');
    const cfg = getConfig();

    const { data: season, error: seasonError } = await sb
      .from('club_seasons')
      .select('*')
      .eq('label', cfg.seasonLabel)
      .maybeSingle();
    if (seasonError) throw seasonError;
    if (!season) throw new Error('Saison introuvable : ' + cfg.seasonLabel);
    state.season = season;

    const { data: tournament, error: tournamentError } = await sb
      .from('tournaments')
      .select('*')
      .eq('season_id', season.id)
      .eq('name', cfg.tournamentName)
      .maybeSingle();
    if (tournamentError) throw tournamentError;
    if (!tournament) throw new Error('Tournoi introuvable : ' + cfg.tournamentName);
    state.tournament = tournament;

    const { data: comps, error: compsError } = await sb
      .from('tournament_competitions')
      .select('*')
      .eq('tournament_id', tournament.id)
      .in('competition_key', ['dm','dh']);
    if (compsError) throw compsError;
    if (!comps || !comps.length) throw new Error('Aucune competition tournoi trouvee en base');
    state.competitionsByKey = new Map(comps.map(c => [normalizeCompetitionKey(c.competition_key), c]));

    const compIds = comps.map(c => c.id);
    const { data: teams, error: teamsError } = await sb
      .from('tournament_teams')
      .select('*')
      .in('competition_id', compIds);
    if (teamsError) throw teamsError;
    state.teamsByKey = new Map();
    (teams || []).forEach(t => {
      const comp = comps.find(c => c.id === t.competition_id);
      if (!comp) return;
      state.teamsByKey.set(teamKey(comp.competition_key, t.team_number), t);
    });

    const teamIds = (teams || []).map(t => t.id);
    let players = [];
    if (teamIds.length) {
      const res = await sb
        .from('tournament_team_players')
        .select('*')
        .in('team_id', teamIds);
      if (res.error) throw res.error;
      players = res.data || [];
    }
    state.playersByKey = new Map();
    (players || []).forEach(p => {
      const team = (teams || []).find(t => t.id === p.team_id);
      if (!team) return;
      const comp = comps.find(c => c.id === team.competition_id);
      if (!comp) return;
      state.playersByKey.set(playerKey(comp.competition_key, team.team_number, p.player_order), p);
    });

    const playerIds = players.map(p => p.id);
    let checkins = [];
    if (playerIds.length) {
      const res = await sb
        .from('tournament_checkins')
        .select('*')
        .in('team_player_id', playerIds);
      if (res.error) throw res.error;
      checkins = res.data || [];
    }
    state.checkinsByPlayerId = new Map((checkins || []).map(c => [c.team_player_id, c]));
    state.cacheLoadedAt = Date.now();
    log('context.loaded', { comps: comps.length, teams: teams.length, players: players.length, checkins: checkins.length });
    return state;
  }

  async function ensureTeam(competitionKey, teamNumber){
    await loadContext(false);
    const compKey = normalizeCompetitionKey(competitionKey);
    const tk = teamKey(compKey, teamNumber);
    const existing = state.teamsByKey.get(tk);
    if (existing) return existing;

    const sb = getSupabaseClient();
    const comp = state.competitionsByKey.get(compKey);
    if (!comp || !comp.id) throw new Error('Competition introuvable pour ' + compKey);

    const code = compKey.toUpperCase() + '-' + String(teamNumber).padStart(2, '0');
    const payload = {
      competition_id: comp.id,
      team_number: Number(teamNumber),
      team_code: code,
      pool_rank: ((Number(teamNumber) - 1) % 4) + 1,
      active: true,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await sb
      .from('tournament_teams')
      .upsert(payload, { onConflict: 'competition_id,team_number' })
      .select('*')
      .maybeSingle();
    if (error) throw error;
    state.teamsByKey.set(tk, data);
    log('team.ensure', { compKey, teamNumber, id: data && data.id });
    return data;
  }

  async function ensurePlayer(competitionKey, teamNumber, playerOrder){
    await loadContext(false);
    const pk = playerKey(competitionKey, teamNumber, playerOrder);
    const existing = state.playersByKey.get(pk);
    if (existing) return existing;

    const sb = getSupabaseClient();
    const team = await ensureTeam(competitionKey, teamNumber);
    if (!team || !team.id) throw new Error('Equipe introuvable pour ' + competitionKey + ' #' + teamNumber);

    const payload = {
      team_id: team.id,
      player_order: Number(playerOrder),
      player_name: '',
      club_name: '',
      updated_at: new Date().toISOString()
    };

    const { data, error } = await sb
      .from('tournament_team_players')
      .upsert(payload, { onConflict: 'team_id,player_order' })
      .select('*')
      .maybeSingle();
    if (error) throw error;
    state.playersByKey.set(pk, data);
    await ensureCheckinForPlayer(data.id);
    log('player.ensure', { competitionKey, teamNumber, playerOrder, id: data.id });
    return data;
  }

  async function ensureCheckinForPlayer(teamPlayerId){
    if (!teamPlayerId) throw new Error('teamPlayerId manquant');
    const existing = state.checkinsByPlayerId.get(teamPlayerId);
    if (existing) return existing;
    const sb = getSupabaseClient();
    const payload = {
      team_player_id: teamPlayerId,
      present: false,
      absent: true,
      paid: false,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await sb
      .from('tournament_checkins')
      .upsert(payload, { onConflict: 'team_player_id' })
      .select('*')
      .maybeSingle();
    if (error) throw error;
    state.checkinsByPlayerId.set(teamPlayerId, data);
    return data;
  }

  async function updateParticipant(competitionKey, teamNumber, playerOrder, patch, options){
    options = options || {};
    markLocalEdit();
    state.saving = true;
    try {
      await loadContext(false);
      const player = await ensurePlayer(competitionKey, teamNumber, playerOrder);
      const cleanPatch = {};
      if (Object.prototype.hasOwnProperty.call(patch, 'player_name')) cleanPatch.player_name = String(patch.player_name || '').trim();
      if (Object.prototype.hasOwnProperty.call(patch, 'club_name')) cleanPatch.club_name = String(patch.club_name || '').trim();
      if (!Object.keys(cleanPatch).length) return player;
      cleanPatch.updated_at = new Date().toISOString();

      const sb = getSupabaseClient();
      const { data, error } = await sb
        .from('tournament_team_players')
        .update(cleanPatch)
        .eq('id', player.id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      state.playersByKey.set(playerKey(competitionKey, teamNumber, playerOrder), data || Object.assign({}, player, cleanPatch));
      await ensureCheckinForPlayer(player.id);
      state.lastSaveAt = new Date().toISOString();
      log('participant.saved', { competitionKey, teamNumber, playerOrder, patch: cleanPatch });
      return data;
    } catch(err) {
      warn('participant.save.error', { message: err.message, competitionKey, teamNumber, playerOrder, patch });
      if (!options.silent) alert('Erreur sauvegarde participant tournoi : ' + err.message);
      throw err;
    } finally {
      state.saving = false;
    }
  }

  async function updateParticipantField(competitionKey, teamNumber, field, value){
    const info = fieldToPlayerPatch(field, value);
    if (!info) return null;
    if (info.order === 0) {
      await updateParticipant(competitionKey, teamNumber, 1, info.patch, { silent: true });
      await updateParticipant(competitionKey, teamNumber, 2, info.patch, { silent: true });
      return true;
    }
    return updateParticipant(competitionKey, teamNumber, info.order, info.patch);
  }

  async function updateCheckin(competitionKey, teamNumber, playerOrder, patch){
    markLocalEdit();
    state.saving = true;
    try {
      const player = await ensurePlayer(competitionKey, teamNumber, playerOrder);
      await ensureCheckinForPlayer(player.id);
      const clean = Object.assign({}, patch, { updated_at: new Date().toISOString() });
      if (Object.prototype.hasOwnProperty.call(clean, 'present') && clean.present === true) clean.absent = false;
      if (Object.prototype.hasOwnProperty.call(clean, 'absent') && clean.absent === true) clean.present = false;
      if (clean.present === true) clean.checked_at = new Date().toISOString();

      const sb = getSupabaseClient();
      const { data, error } = await sb
        .from('tournament_checkins')
        .upsert(Object.assign({ team_player_id: player.id }, clean), { onConflict: 'team_player_id' })
        .select('*')
        .maybeSingle();
      if (error) throw error;
      state.checkinsByPlayerId.set(player.id, data);
      state.lastSaveAt = new Date().toISOString();
      log('checkin.saved', { competitionKey, teamNumber, playerOrder, patch: clean });
      return data;
    } catch(err) {
      warn('checkin.save.error', { message: err.message, competitionKey, teamNumber, playerOrder, patch });
      alert('Erreur sauvegarde emargement : ' + err.message);
      throw err;
    } finally {
      state.saving = false;
    }
  }

  function getCurrentPageKey(){
    const active = document.querySelector('.tab.active, .page.active, [data-page].active, [data-current-page]');
    if (active) return active.getAttribute('data-page') || active.id || active.getAttribute('data-current-page') || '';
    return String(window.currentTab || window.currentPage || '').toLowerCase();
  }

  function looksLikeEmargementPage(){
    const key = getCurrentPageKey().toLowerCase();
    if (key.includes('emarg')) return true;
    const text = (document.body && document.body.innerText || '').slice(0, 4000).toLowerCase();
    return text.includes('émargement') || text.includes('emargement');
  }

  function restoreEmargementIfNeeded(){
    if (Date.now() - state.lastEditAt > LOCAL_EDIT_GUARD_MS) return;
    if (looksLikeEmargementPage()) return;
    log('nav.restore.emargement', {});
    try {
      if (typeof window.switchTab === 'function') {
        window.switchTab('emargement');
        return;
      }
      if (typeof window.openEmargement === 'function') {
        window.openEmargement();
        return;
      }
      const btn = Array.from(document.querySelectorAll('button,a')).find(el => /émargement|emargement/i.test(el.textContent || ''));
      if (btn) btn.click();
    } catch(e) {
      warn('nav.restore.error', { message: e.message });
    }
  }

  function wrapFunction(name, wrapper){
    const original = window[name];
    if (typeof original !== 'function') return false;
    if (original.__tbkV112AWrapped) return true;
    const wrapped = wrapper(original);
    wrapped.__tbkV112AWrapped = true;
    window[name] = wrapped;
    log('wrap.' + name, {});
    return true;
  }

  function installWrappers(){
    wrapFunction('editTeamFromEmargement', original => function(key, id, field, value){
      const result = original.apply(this, arguments);
      const competitionKey = normalizeCompetitionKey(key);
      const teamNumber = normalizeTeamNumber(id);
      if (competitionKey && teamNumber) {
        updateParticipantField(competitionKey, teamNumber, field, value).catch(()=>{});
      }
      setTimeout(restoreEmargementIfNeeded, 100);
      return result;
    });

    wrapFunction('teamEdit', original => function(key, id, field, value){
      const result = original.apply(this, arguments);
      const competitionKey = normalizeCompetitionKey(key);
      const teamNumber = normalizeTeamNumber(id);
      if (competitionKey && teamNumber) {
        updateParticipantField(competitionKey, teamNumber, field, value).catch(()=>{});
      }
      setTimeout(restoreEmargementIfNeeded, 100);
      return result;
    });

    // Protection navigation : eviter le retour automatique vers inscriptions apres une saisie emargement
    wrapFunction('openInscriptionsHome', original => function(){
      if (Date.now() - state.lastEditAt < LOCAL_EDIT_GUARD_MS) {
        log('nav.block.openInscriptionsHome', {});
        setTimeout(restoreEmargementIfNeeded, 50);
        return false;
      }
      return original.apply(this, arguments);
    });

    wrapFunction('switchTab', original => function(tab){
      const wanted = String(tab || '').toLowerCase();
      if ((wanted.includes('inscription') || wanted === 'inscriptions') && Date.now() - state.lastEditAt < LOCAL_EDIT_GUARD_MS) {
        log('nav.block.switchTab', { tab });
        setTimeout(restoreEmargementIfNeeded, 50);
        return false;
      }
      return original.apply(this, arguments);
    });
  }

  function inferMetaFromElement(el){
    // Best effort : permet de capturer des champs qui ne passent pas par editTeamFromEmargement.
    const attrs = ['data-comp','data-competition','data-key','data-tournament','data-team','data-team-number','data-id','data-field','name','id'];
    const meta = {};
    attrs.forEach(a => { const v = el.getAttribute && el.getAttribute(a); if (v) meta[a] = v; });
    const raw = Object.values(meta).join(' ');
    const comp = /\bdh\b/i.test(raw) ? 'dh' : (/\bdm\b/i.test(raw) ? 'dm' : null);
    const teamMatch = raw.match(/(?:team|equipe|eq|dm|dh)[_\- ]?(\d{1,2})/i) || raw.match(/\b(\d{1,2})\b/);
    const teamNumber = teamMatch ? parseInt(teamMatch[1], 10) : null;
    let field = meta['data-field'] || meta.name || meta.id || '';
    field = String(field).toLowerCase();
    if (field.includes('club1') || field.includes('club_j1')) field = 'club1';
    else if (field.includes('club2') || field.includes('club_j2')) field = 'club2';
    else if (field.includes('j1') || field.includes('player1') || field.includes('participant1')) field = 'j1';
    else if (field.includes('j2') || field.includes('player2') || field.includes('participant2')) field = 'j2';
    return { competitionKey: comp, teamNumber, field };
  }

  function installDomCapture(){
    document.addEventListener('change', function(ev){
      const el = ev.target;
      if (!el || !looksLikeEmargementPage()) return;
      const meta = inferMetaFromElement(el);
      if (!meta.competitionKey || !meta.teamNumber || !meta.field) return;
      const info = fieldToPlayerPatch(meta.field, el.value);
      if (!info) return;
      updateParticipantField(meta.competitionKey, meta.teamNumber, meta.field, el.value).catch(()=>{});
    }, true);

    document.addEventListener('blur', function(ev){
      const el = ev.target;
      if (!el || !looksLikeEmargementPage()) return;
      const meta = inferMetaFromElement(el);
      if (!meta.competitionKey || !meta.teamNumber || !meta.field) return;
      const info = fieldToPlayerPatch(meta.field, el.value);
      if (!info) return;
      updateParticipantField(meta.competitionKey, meta.teamNumber, meta.field, el.value).catch(()=>{});
    }, true);
  }

  function installDebugBadge(){
    if (document.getElementById('tbk-v112a-badge')) return;
    const badge = document.createElement('button');
    badge.id = 'tbk-v112a-badge';
    badge.type = 'button';
    badge.textContent = '🧩 V112A Tournoi';
    badge.title = 'Diagnostic refactoring emargement V112A';
    badge.style.position = 'fixed';
    badge.style.right = '14px';
    badge.style.bottom = '64px';
    badge.style.zIndex = '99999';
    badge.style.border = '1px solid #bfdbfe';
    badge.style.background = '#eff6ff';
    badge.style.color = '#1d4ed8';
    badge.style.padding = '7px 10px';
    badge.style.borderRadius = '999px';
    badge.style.fontSize = '12px';
    badge.style.fontWeight = '700';
    badge.style.boxShadow = '0 4px 14px rgba(0,0,0,.12)';
    badge.onclick = function(){
      const d = window.tbkV112ADiagnostic();
      console.log(LOG_PREFIX, 'diagnostic', d);
      alert('Diagnostic V112A disponible dans la console.\nParticipants cache: ' + d.playersCached + '\nCheckins cache: ' + d.checkinsCached + '\nDerniere sauvegarde: ' + (d.lastSaveAt || '-'));
    };
    document.body.appendChild(badge);
  }

  window.TBKV112A = Object.assign(state, {
    loadContext,
    updateParticipant,
    updateParticipantField,
    updateCheckin,
    ensurePlayer,
    ensureCheckinForPlayer
  });

  window.tbkV112ADiagnostic = function(){
    return {
      version: VERSION,
      clientAvailable: !!getSupabaseClient(),
      cacheLoadedAt: state.cacheLoadedAt ? new Date(state.cacheLoadedAt).toISOString() : null,
      season: state.season && state.season.label,
      tournament: state.tournament && state.tournament.name,
      competitions: Array.from(state.competitionsByKey.keys()),
      teamsCached: state.teamsByKey.size,
      playersCached: state.playersByKey.size,
      checkinsCached: state.checkinsByPlayerId.size,
      saving: state.saving,
      lastSaveAt: state.lastSaveAt,
      lastError: state.lastError,
      recentLogs: state.logs.slice(-25)
    };
  };

  function boot(){
    installWrappers();
    installDomCapture();
    installDebugBadge();
    loadContext(false).catch(err => warn('boot.context.error', { message: err.message }));
    log('installed', { version: VERSION });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Re-tente les wrappers si des scripts tardifs remplacent encore les fonctions.
  setTimeout(installWrappers, 1500);
  setTimeout(installWrappers, 4000);
})();
