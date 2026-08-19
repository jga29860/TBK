/*
  TBK V112B - Refactoring Tournoi : scores + planning + reset RPC
  Objectif : centraliser les écritures ciblées vers Supabase pour éviter les sauvegardes globales.
  Chargez ce fichier APRES V112A, V91, V92, V93, V103, V109, V110.
*/
(function(){
  'use strict';

  const VERSION = 'V112B';
  const LOG_PREFIX = '[TBK V112B Tournoi]';
  const DEFAULT_SEASON = '2026-2027';
  const DEFAULT_TOURNAMENT = 'Tournoi TBK 2026-2027';
  const SCORE_SAVE_DELAY_MS = 900;
  const LOCAL_GUARD_MS = 3500;

  if (window.TBKV112B && window.TBKV112B.__installed) {
    console.warn(LOG_PREFIX, 'deja installe');
    return;
  }

  const st = {
    __installed: true,
    version: VERSION,
    contextLoadedAt: 0,
    season: null,
    tournament: null,
    competitionsByKey: new Map(),
    competitionsById: new Map(),
    poolsByKey: new Map(),
    teamsByKey: new Map(),
    teamsById: new Map(),
    matchesByKey: new Map(),
    courtsByNumber: new Map(),
    pendingScoreTimer: null,
    lastScoreHash: '',
    scoring: false,
    logs: [],
    lastError: null,
    lastScoreSaveAt: null,
    lastPlanningSaveAt: null,
    lastResetAt: null
  };

  function log(type, details){
    const entry = { at: new Date().toISOString(), type, details: details || {} };
    st.logs.push(entry);
    if (st.logs.length > 300) st.logs.shift();
    try { console.debug(LOG_PREFIX, type, details || ''); } catch(e) {}
  }
  function warn(type, details){
    const entry = { at: new Date().toISOString(), type: 'warn.' + type, details: details || {} };
    st.logs.push(entry);
    st.lastError = entry;
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
      window.__tbkSupabaseClient,
      window.__tbkV112SupabaseClient
    ].filter(Boolean);
    for (const c of candidates) if (c && typeof c.from === 'function') return c;
    const cfg = getConfig();
    if (window.supabase && typeof window.supabase.createClient === 'function' && cfg.url && cfg.anonKey) {
      window.__tbkV112BSupabaseClient = window.__tbkV112BSupabaseClient || window.supabase.createClient(cfg.url, cfg.anonKey);
      return window.__tbkV112BSupabaseClient;
    }
    return null;
  }

  function normalizeCompetitionKey(key){
    const v = String(key || '').trim().toLowerCase();
    if (v.includes('dh')) return 'dh';
    if (v.includes('dm')) return 'dm';
    return v;
  }
  function teamKey(compKey, teamNumber){ return `${normalizeCompetitionKey(compKey)}:${Number(teamNumber)}`; }
  function matchKey(compKey, matchNumber){ return `${normalizeCompetitionKey(compKey)}:${Number(matchNumber)}`; }
  function poolKey(compKey, key){ return `${normalizeCompetitionKey(compKey)}:${String(key || '').trim().toUpperCase()}`; }

  function markLocalTournamentEdit(ms){
    const until = Date.now() + (ms || LOCAL_GUARD_MS);
    window.TBK_V112B_LOCAL_TOURNAMENT_EDIT_UNTIL = until;
    window.TBK_SUPPRESS_GLOBAL_AUTOSAVE_UNTIL = Math.max(window.TBK_SUPPRESS_GLOBAL_AUTOSAVE_UNTIL || 0, until);
    window.TBK_V103_SCORE_LOCAL_EDIT_UNTIL = Math.max(window.TBK_V103_SCORE_LOCAL_EDIT_UNTIL || 0, until);
    try { sessionStorage.setItem('tbk_v112b_last_page', currentPageKey()); } catch(e) {}
  }

  function currentPageKey(){
    try {
      if (document.querySelector('#emargement.active, .tab-content.active#emargement')) return 'emargement';
      if (document.querySelector('#planning.active, .tab-content.active#planning')) return 'planning';
    } catch(e) {}
    return String(window.currentTab || window.currentPage || '').toLowerCase();
  }

  async function loadContext(force){
    const now = Date.now();
    if (!force && st.contextLoadedAt && now - st.contextLoadedAt < 2500) return st;
    const sb = getSupabaseClient();
    if (!sb) throw new Error('Client Supabase introuvable pour V112B');
    const cfg = getConfig();

    const { data: season, error: seasonError } = await sb.from('club_seasons').select('*').eq('label', cfg.seasonLabel).maybeSingle();
    if (seasonError) throw seasonError;
    if (!season) throw new Error('Saison introuvable : ' + cfg.seasonLabel);
    st.season = season;

    const { data: tournament, error: tournamentError } = await sb.from('tournaments').select('*').eq('season_id', season.id).eq('name', cfg.tournamentName).maybeSingle();
    if (tournamentError) throw tournamentError;
    if (!tournament) throw new Error('Tournoi introuvable : ' + cfg.tournamentName);
    st.tournament = tournament;

    const { data: comps, error: compsError } = await sb.from('tournament_competitions').select('*').eq('tournament_id', tournament.id).in('competition_key', ['dm','dh']);
    if (compsError) throw compsError;
    if (!comps || !comps.length) throw new Error('Aucune compétition tournoi trouvée en base');
    st.competitionsByKey = new Map();
    st.competitionsById = new Map();
    comps.forEach(c => { st.competitionsByKey.set(normalizeCompetitionKey(c.competition_key), c); st.competitionsById.set(c.id, c); });

    const compIds = comps.map(c => c.id);
    const { data: pools, error: poolsError } = await sb.from('tournament_pools').select('*').in('competition_id', compIds);
    if (poolsError) throw poolsError;
    st.poolsByKey = new Map();
    (pools || []).forEach(p => {
      const comp = st.competitionsById.get(p.competition_id);
      if (comp) st.poolsByKey.set(poolKey(comp.competition_key, p.pool_key), p);
    });

    const { data: teams, error: teamsError } = await sb.from('tournament_teams').select('*').in('competition_id', compIds);
    if (teamsError) throw teamsError;
    st.teamsByKey = new Map(); st.teamsById = new Map();
    (teams || []).forEach(t => {
      const comp = st.competitionsById.get(t.competition_id);
      if (!comp) return;
      st.teamsByKey.set(teamKey(comp.competition_key, t.team_number), t);
      st.teamsById.set(t.id, t);
    });

    const { data: courts, error: courtsError } = await sb.from('tournament_courts').select('*').eq('tournament_id', tournament.id);
    if (!courtsError) {
      st.courtsByNumber = new Map((courts || []).map(c => [Number(c.court_number), c]));
    }

    const { data: matches, error: matchesError } = await sb.from('tournament_matches').select('*').in('competition_id', compIds);
    if (!matchesError) {
      st.matchesByKey = new Map();
      (matches || []).forEach(m => {
        const comp = st.competitionsById.get(m.competition_id);
        if (comp) st.matchesByKey.set(matchKey(comp.competition_key, m.match_number), m);
      });
    }

    st.contextLoadedAt = Date.now();
    log('context.loaded', { competitions: comps.length, teams: (teams || []).length, matches: (matches || []).length });
    return st;
  }

  function parseTeamNumberFromAny(v){
    if (typeof v === 'number') return v;
    const s = String(v || '').trim();
    const m = s.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function localTeamToDbId(compKey, ref){
    const num = parseTeamNumberFromAny(ref);
    if (!num) return null;
    const t = st.teamsByKey.get(teamKey(compKey, num));
    return t ? t.id : null;
  }

  function findLocalMatchById(id){
    const allKeys = ['dm','dh'];
    const sid = String(id || '');
    for (const key of allKeys) {
      const comp = (window.state && window.state[key]) || {};
      const pools = Array.isArray(comp.matches) ? comp.matches : [];
      for (const m of pools) {
        if (String(m.id || m.match_id || `${key}-${m.n || m.match_number}`) === sid || String(m.n || m.match_number) === sid) return { compKey: key, match: m };
      }
      const koCollections = [comp.ko, comp.finalMatches, comp.tableau, comp.matchesKo].filter(Boolean);
      for (const coll of koCollections) {
        const arr = Array.isArray(coll) ? coll : Object.values(coll).flat().filter(Boolean);
        for (const m of arr) {
          if (!m || typeof m !== 'object') continue;
          if (String(m.id || m.match_id || `${key}-${m.n || m.match_number}`) === sid || String(m.n || m.match_number) === sid) return { compKey: key, match: m };
        }
      }
    }
    return null;
  }

  function normalizeScoreValue(v){
    if (v === '' || v === null || v === undefined) return null;
    const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
    if (Number.isNaN(n)) return null;
    return Math.max(0, Math.min(30, n));
  }

  function extractScoresFromMatch(m){
    const raw = m && (m.scores || m.score || m.sets) || [];
    const result = [];
    for (let i = 0; i < 3; i++) {
      const row = raw[i] || [];
      result.push([normalizeScoreValue(row[0]), normalizeScoreValue(row[1])]);
    }
    return result;
  }

  function computeWinnerFromScores(m){
    const scores = extractScoresFromMatch(m);
    let aSets = 0, bSets = 0;
    scores.forEach(([a,b]) => {
      if (a === null || b === null) return;
      if (a > b) aSets += 1;
      if (b > a) bSets += 1;
    });
    const done = aSets >= 2 || bSets >= 2 || !!m.done;
    const aRef = m.a || m.teamA || m.team_a || m.team1 || m.e1;
    const bRef = m.b || m.teamB || m.team_b || m.team2 || m.e2;
    return {
      done,
      winnerRef: done ? (aSets > bSets ? aRef : bRef) : null,
      loserRef: done ? (aSets > bSets ? bRef : aRef) : null
    };
  }

  async function ensureDbMatch(compKey, localMatch){
    await loadContext(false);
    const sb = getSupabaseClient();
    const comp = st.competitionsByKey.get(normalizeCompetitionKey(compKey));
    if (!comp) throw new Error('Compétition introuvable pour match : ' + compKey);
    const n = Number(localMatch.n || localMatch.match_number || localMatch.matchNumber || localMatch.number);
    if (!n) throw new Error('Numéro de match manquant');
    const existing = st.matchesByKey.get(matchKey(compKey, n));
    const winnerInfo = computeWinnerFromScores(localMatch);
    const teamARef = localMatch.a || localMatch.teamA || localMatch.team_a || localMatch.team1 || localMatch.e1;
    const teamBRef = localMatch.b || localMatch.teamB || localMatch.team_b || localMatch.team2 || localMatch.e2;
    const payload = {
      competition_id: comp.id,
      match_number: n,
      phase: localMatch.phase || localMatch.stage || 'Poule',
      bracket: localMatch.bracket || localMatch.tableau || null,
      pool_id: localMatch.pool ? (st.poolsByKey.get(poolKey(compKey, localMatch.pool)) || {}).id || null : null,
      team_a_id: localTeamToDbId(compKey, teamARef),
      team_b_id: localTeamToDbId(compKey, teamBRef),
      seed_a: String(teamARef || ''),
      seed_b: String(teamBRef || ''),
      done: !!winnerInfo.done,
      winner_team_id: localTeamToDbId(compKey, winnerInfo.winnerRef),
      loser_team_id: localTeamToDbId(compKey, winnerInfo.loserRef),
      updated_at: new Date().toISOString()
    };
    let row = existing;
    if (existing && existing.id) {
      const { data, error } = await sb.from('tournament_matches').update(payload).eq('id', existing.id).select('*').maybeSingle();
      if (error) throw error;
      row = data || existing;
    } else {
      const { data, error } = await sb.from('tournament_matches').upsert(payload, { onConflict: 'competition_id,match_number' }).select('*').maybeSingle();
      if (error) throw error;
      row = data;
    }
    if (row) st.matchesByKey.set(matchKey(compKey, n), row);
    return row;
  }

  async function saveScoreForLocalMatch(compKey, localMatch){
    markLocalTournamentEdit(4500);
    const sb = getSupabaseClient();
    if (!sb) throw new Error('Client Supabase introuvable');
    const dbMatch = await ensureDbMatch(compKey, localMatch);
    if (!dbMatch || !dbMatch.id) throw new Error('Match Supabase introuvable/après upsert');
    const scores = extractScoresFromMatch(localMatch);
    const rows = scores.map((s, idx) => ({
      match_id: dbMatch.id,
      set_number: idx + 1,
      score_a: s[0],
      score_b: s[1],
      updated_at: new Date().toISOString()
    }));
    const { error } = await sb.from('tournament_match_sets').upsert(rows, { onConflict: 'match_id,set_number' });
    if (error) throw error;
    st.lastScoreSaveAt = new Date().toISOString();
    try {
      await sb.from('tournament_match_events').insert({
        match_id: dbMatch.id,
        event_type: 'score_saved_v112b',
        event_data: { scores, done: !!dbMatch.done, source: 'V112B' }
      });
    } catch(e) {}
    log('score.saved', { compKey, match: dbMatch.match_number, scores });
    return true;
  }

  function hashLocalScores(){
    try {
      const parts = [];
      ['dm','dh'].forEach(key => {
        const comp = (window.state && window.state[key]) || {};
        const arrs = [];
        if (Array.isArray(comp.matches)) arrs.push(comp.matches);
        ['ko','finalMatches','tableau','matchesKo'].forEach(k => {
          const v = comp[k];
          if (Array.isArray(v)) arrs.push(v);
          else if (v && typeof v === 'object') arrs.push(Object.values(v).flat().filter(Boolean));
        });
        arrs.flat().forEach(m => {
          if (!m || typeof m !== 'object') return;
          parts.push([key, m.n || m.match_number || m.id, extractScoresFromMatch(m), !!m.done]);
        });
      });
      return JSON.stringify(parts);
    } catch(e) { return String(Date.now()); }
  }

  function queueScoreSave(reason){
    clearTimeout(st.pendingScoreTimer);
    st.pendingScoreTimer = setTimeout(async () => {
      try {
        const h = hashLocalScores();
        if (h === st.lastScoreHash) { log('scores.skip.identical', { reason }); return; }
        st.scoring = true;
        const all = [];
        ['dm','dh'].forEach(key => {
          const comp = (window.state && window.state[key]) || {};
          if (Array.isArray(comp.matches)) comp.matches.forEach(m => all.push({ compKey: key, match: m }));
          ['ko','finalMatches','tableau','matchesKo'].forEach(k => {
            const v = comp[k];
            if (Array.isArray(v)) v.forEach(m => all.push({ compKey: key, match: m }));
            else if (v && typeof v === 'object') Object.values(v).flat().filter(Boolean).forEach(m => all.push({ compKey: key, match: m }));
          });
        });
        for (const item of all) {
          const scores = extractScoresFromMatch(item.match);
          const hasAny = scores.some(s => s[0] !== null || s[1] !== null);
          if (hasAny || item.match.done) await saveScoreForLocalMatch(item.compKey, item.match);
        }
        st.lastScoreHash = h;
        setScoreSaveBadge('ok', '✅ Score enregistré');
      } catch(e) {
        warn('score.save.error', { message: e.message || String(e) });
        setScoreSaveBadge('error', '⚠ Score non enregistré');
      } finally {
        st.scoring = false;
      }
    }, SCORE_SAVE_DELAY_MS);
  }

  function ensureScoreSaveBadge(){
    let el = document.getElementById('tbk-v112b-score-save-badge');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'tbk-v112b-score-save-badge';
    el.textContent = '💾 Scores prêts';
    el.style.position = 'fixed';
    el.style.right = '16px';
    el.style.top = '58px';
    el.style.zIndex = '99998';
    el.style.padding = '6px 10px';
    el.style.borderRadius = '999px';
    el.style.background = '#eef2ff';
    el.style.border = '1px solid #c7d2fe';
    el.style.color = '#3730a3';
    el.style.fontSize = '12px';
    el.style.fontWeight = '700';
    document.body.appendChild(el);
    return el;
  }
  function setScoreSaveBadge(kind, label){
    const el = ensureScoreSaveBadge();
    el.textContent = label;
    if (kind === 'pending') { el.style.background = '#fff7ed'; el.style.borderColor = '#fed7aa'; el.style.color = '#9a3412'; }
    if (kind === 'ok') { el.style.background = '#ecfdf5'; el.style.borderColor = '#bbf7d0'; el.style.color = '#166534'; }
    if (kind === 'error') { el.style.background = '#fef2f2'; el.style.borderColor = '#fecaca'; el.style.color = '#991b1b'; }
  }

  function moveToNextScoreInput(current){
    setTimeout(() => {
      try {
        const inputs = Array.from(document.querySelectorAll('input[data-score], input.score-input, input[type="number"].score, input[type="text"].score-input'))
          .filter(el => !el.disabled && el.offsetParent !== null);
        const idx = inputs.indexOf(current);
        if (idx >= 0 && inputs[idx + 1]) {
          inputs[idx + 1].focus();
          inputs[idx + 1].select && inputs[idx + 1].select();
        }
      } catch(e) {}
    }, 150);
  }

  function installScoreBridges(){
    const oldSetScoreById = window.setScoreById;
    if (typeof oldSetScoreById === 'function') {
      window.setScoreById = function(id, setIdx, sideIdx, value){
        const v = normalizeScoreValue(value);
        markLocalTournamentEdit(4500);
        const res = oldSetScoreById.call(this, id, setIdx, sideIdx, v == null ? '' : v);
        const found = findLocalMatchById(id);
        if (found) {
          setScoreSaveBadge('pending', '💾 Score en cours...');
          queueScoreSave('setScoreById');
        }
        return res;
      };
      log('bridge.setScoreById.installed');
    }

    document.addEventListener('input', function(ev){
      const el = ev.target;
      if (!el || !el.matches || !el.matches('input[data-score], input.score-input, input[type="number"].score, input[type="text"].score-input')) return;
      const clean = normalizeScoreValue(el.value);
      if (clean !== null && String(clean) !== String(el.value)) el.value = String(clean);
      setScoreSaveBadge('pending', '💾 Score en cours...');
      markLocalTournamentEdit(4500);
      queueScoreSave('score-input-event');
      if (String(el.value).length >= 2) moveToNextScoreInput(el);
    }, true);
  }

  async function saveCourtAssignment(compKey, matchNumber, courtNumber){
    markLocalTournamentEdit(3500);
    const sb = getSupabaseClient();
    if (!sb) throw new Error('Client Supabase introuvable');
    await loadContext(false);
    const m = st.matchesByKey.get(matchKey(compKey, matchNumber));
    if (!m) throw new Error('Match introuvable pour affectation terrain');
    const court = st.courtsByNumber.get(Number(courtNumber));
    if (!court) throw new Error('Terrain introuvable : ' + courtNumber);
    const payload = {
      match_id: m.id,
      court_id: court.id,
      assigned_at: new Date().toISOString(),
      manual: true,
      updated_at: new Date().toISOString()
    };
    const { error } = await sb.from('tournament_court_assignments').upsert(payload, { onConflict: 'match_id' });
    if (error) throw error;
    st.lastPlanningSaveAt = new Date().toISOString();
    log('court.assigned', { compKey, matchNumber, courtNumber });
    return true;
  }

  function installPlanningBridges(){
    document.addEventListener('change', async function(ev){
      const el = ev.target;
      if (!el || !el.matches) return;
      const isCourt = el.matches('[data-court], [data-terrain], select.court-select, select.terrain-select');
      if (!isCourt) return;
      try {
        const row = el.closest('[data-match-id], [data-match-number], tr');
        const compKey = normalizeCompetitionKey(el.dataset.competition || row?.dataset?.competition || row?.dataset?.comp || window.currentCompetition || '');
        const matchNumber = parseTeamNumberFromAny(el.dataset.matchNumber || row?.dataset?.matchNumber || row?.dataset?.matchId || row?.querySelector?.('[data-match-number]')?.dataset?.matchNumber);
        const courtNumber = parseTeamNumberFromAny(el.value || el.dataset.court || el.dataset.terrain);
        if (compKey && matchNumber && courtNumber) await saveCourtAssignment(compKey, matchNumber, courtNumber);
      } catch(e) { warn('court.assign.error', { message: e.message || String(e) }); }
    }, true);
  }

  async function resetTournamentViaRpc(){
    const sb = getSupabaseClient();
    if (!sb) throw new Error('Client Supabase introuvable');
    const cfg = getConfig();
    window.TBK_BULK_RESET_IN_PROGRESS = true;
    window.TBK_SUPPRESS_GLOBAL_AUTOSAVE_UNTIL = Date.now() + 30000;
    window.TBK_REALTIME_PAUSED_UNTIL = Date.now() + 30000;
    try { if (typeof window.stopRealtimeV94 === 'function') window.stopRealtimeV94(); } catch(e) {}
    const { data, error } = await sb.rpc('tbk_rpc_reset_tournament_full', {
      p_season_label: cfg.seasonLabel,
      p_tournament_name: cfg.tournamentName
    });
    if (error) throw error;
    st.lastResetAt = new Date().toISOString();
    log('reset.rpc.done', data || {});
    await loadContext(true);
    setTimeout(() => {
      window.TBK_BULK_RESET_IN_PROGRESS = false;
      try { if (typeof window.startRealtimeV94 === 'function') window.startRealtimeV94(); } catch(e) {}
    }, 6000);
    return data;
  }

  function installResetBridge(){
    window.tbkV112BResetTournamentRpc = resetTournamentViaRpc;
    const oldReset = window.tbkAdminResetTournament || window.tbkResetTournamentAdmin;
    if (typeof oldReset === 'function') {
      window.tbkAdminResetTournament = async function(){
        if (!confirm('Confirmer la réinitialisation du tournoi ? Un export SQL sera généré côté RPC si la fonction le prévoit.')) return false;
        const phrase = prompt('Saisis RESET TOURNOI pour confirmer.');
        if (phrase !== 'RESET TOURNOI') return false;
        return resetTournamentViaRpc();
      };
    }
  }

  function installLoadGuards(){
    const oldLoadScores = window.loadTournamentScoresRelationalV92;
    if (typeof oldLoadScores === 'function') {
      window.loadTournamentScoresRelationalV92 = async function(){
        if (Date.now() < (window.TBK_V112B_LOCAL_TOURNAMENT_EDIT_UNTIL || 0)) {
          log('scores.load.skip.local-guard');
          return null;
        }
        return oldLoadScores.apply(this, arguments);
      };
    }
    const oldSaveTournament = window.saveTournamentRelationalV91;
    if (typeof oldSaveTournament === 'function') {
      window.saveTournamentRelationalV91 = async function(){
        if (Date.now() < (window.TBK_SUPPRESS_GLOBAL_AUTOSAVE_UNTIL || 0) || window.TBK_BULK_RESET_IN_PROGRESS) {
          log('global.save.skip.guard');
          return false;
        }
        return oldSaveTournament.apply(this, arguments);
      };
    }
  }

  function installDiagnosticButton(){
    if (document.getElementById('tbk-v112b-diagnostic-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'tbk-v112b-diagnostic-btn';
    btn.textContent = '🧩 V112B';
    btn.title = 'Diagnostic refactoring tournoi V112B';
    btn.style.position = 'fixed';
    btn.style.right = '16px';
    btn.style.bottom = '76px';
    btn.style.zIndex = '99999';
    btn.style.borderRadius = '999px';
    btn.style.padding = '8px 12px';
    btn.style.border = '1px solid #c7d2fe';
    btn.style.background = '#eef2ff';
    btn.style.color = '#3730a3';
    btn.style.fontWeight = '700';
    btn.onclick = function(){ console.log('TBK V112B diagnostic', window.tbkV112BDiagnostic()); alert('Diagnostic V112B envoyé dans la console.'); };
    document.body.appendChild(btn);
  }

  window.tbkV112BDiagnostic = function(){
    return {
      version: VERSION,
      contextLoadedAt: st.contextLoadedAt ? new Date(st.contextLoadedAt).toISOString() : null,
      season: st.season && st.season.label,
      tournament: st.tournament && st.tournament.name,
      competitions: Array.from(st.competitionsByKey.keys()),
      teams: st.teamsByKey.size,
      matches: st.matchesByKey.size,
      courts: st.courtsByNumber.size,
      lastScoreHash: st.lastScoreHash,
      pendingScoreTimer: !!st.pendingScoreTimer,
      scoring: st.scoring,
      lastScoreSaveAt: st.lastScoreSaveAt,
      lastPlanningSaveAt: st.lastPlanningSaveAt,
      lastResetAt: st.lastResetAt,
      localGuardActive: Date.now() < (window.TBK_V112B_LOCAL_TOURNAMENT_EDIT_UNTIL || 0),
      bulkResetInProgress: !!window.TBK_BULK_RESET_IN_PROGRESS,
      lastError: st.lastError,
      recentLogs: st.logs.slice(-20)
    };
  };

  async function init(){
    try {
      ensureScoreSaveBadge();
      installScoreBridges();
      installPlanningBridges();
      installResetBridge();
      installLoadGuards();
      installDiagnosticButton();
      await loadContext(false).catch(e => warn('init.context.error', { message: e.message || String(e) }));
      log('installed', { version: VERSION });
    } catch(e) {
      warn('install.error', { message: e.message || String(e) });
    }
  }

  window.TBKV112B = st;
  window.tbkV112BLoadTournamentContext = loadContext;
  window.tbkV112BSaveScoreForLocalMatch = saveScoreForLocalMatch;
  window.tbkV112BSaveCourtAssignment = saveCourtAssignment;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
