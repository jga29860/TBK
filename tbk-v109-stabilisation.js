/*
  TBK V109 - Stabilisation relationnelle
  Objectif : réduire les sauvegardes globales dangereuses, améliorer les écritures ciblées,
  ajouter un diagnostic administrateur, et protéger la base Supabase contre les écrasements par état local vide.

  A charger en dernier dans index.html, après V108 / V107 / V106 / V105 / V103 / V101 / V95C.
*/
(function(){
  'use strict';

  const VERSION = 'V109';
  const LOG_PREFIX = '[TBK V109]';
  const SAVE_GUARD_MS = 3500;
  const RESET_GUARD_MS = 15000;

  const state = window.TBK_V109 = window.TBK_V109 || {
    version: VERSION,
    installedAt: new Date().toISOString(),
    lastDomainSave: {},
    lastBlockedSave: null,
    lastDiagnostics: null,
    suppressGlobalSaveUntil: 0,
    suppressRealtimeUntil: 0,
    currentDomain: null,
    logs: []
  };

  function now(){ return Date.now(); }
  function log(type, details){
    const item = { at: new Date().toISOString(), type, details: details || {} };
    state.logs.push(item);
    if(state.logs.length > 300) state.logs.shift();
    try { console.debug(LOG_PREFIX, type, details || ''); } catch(e) {}
    updateMiniBadge(type);
  }

  function getSupabaseClient(){
    return window.tbkSupabase ||
           window.supabaseClient ||
           window.TBK_SUPABASE_CLIENT ||
           (window.TBK && window.TBK.supabase) ||
           window.__tbkSupabase ||
           null;
  }

  function getAppState(){
    return window.state || window.tbkState || (window.TBK && window.TBK.state) || null;
  }

  function isAdmin(){
    const candidates = [
      window.currentUserProfileCode,
      window.currentProfileCode,
      window.currentUserProfile && window.currentUserProfile.profile_code,
      window.currentUser && window.currentUser.profile_code,
      window.TBK_CURRENT_USER && window.TBK_CURRENT_USER.profile_code,
      window.authUser && window.authUser.profile_code
    ].filter(Boolean).map(String);
    return candidates.some(v => v.toLowerCase() === 'administrateur' || v.toLowerCase() === 'admin');
  }

  function countObject(o){ return o && typeof o === 'object' ? Object.keys(o).length : 0; }
  function hasTournamentData(localState){
    if(!localState || typeof localState !== 'object') return false;
    const dmTeams = countObject(localState.dm && localState.dm.teams);
    const dhTeams = countObject(localState.dh && localState.dh.teams);
    const dmMatches = Array.isArray(localState.dm && localState.dm.matches) ? localState.dm.matches.length : 0;
    const dhMatches = Array.isArray(localState.dh && localState.dh.matches) ? localState.dh.matches.length : 0;
    return (dmTeams >= 1 || dhTeams >= 1 || dmMatches >= 1 || dhMatches >= 1);
  }

  function enterDomain(domain, ms){
    state.currentDomain = domain;
    state.suppressGlobalSaveUntil = Math.max(state.suppressGlobalSaveUntil || 0, now() + (ms || SAVE_GUARD_MS));
    if(domain === 'reset') {
      state.suppressRealtimeUntil = Math.max(state.suppressRealtimeUntil || 0, now() + RESET_GUARD_MS);
      window.TBK_BULK_RESET_IN_PROGRESS = true;
      window.TBK_REALTIME_PAUSED_UNTIL = state.suppressRealtimeUntil;
    }
    log('domain.enter', { domain, until: state.suppressGlobalSaveUntil });
  }

  function leaveDomain(domain){
    if(state.currentDomain === domain) state.currentDomain = null;
    if(domain === 'reset') {
      setTimeout(function(){
        window.TBK_BULK_RESET_IN_PROGRESS = false;
        state.suppressRealtimeUntil = 0;
        window.TBK_REALTIME_PAUSED_UNTIL = 0;
        log('reset.guard.end');
      }, 3000);
    }
    log('domain.leave', { domain });
  }

  function globalSaveSuppressed(){
    return now() < (state.suppressGlobalSaveUntil || 0) || !!window.TBK_BULK_RESET_IN_PROGRESS;
  }

  function realtimeSuppressed(){
    return now() < (state.suppressRealtimeUntil || 0) || !!window.TBK_BULK_RESET_IN_PROGRESS;
  }

  function wrapGlobalSave(){
    const names = ['save','saveAll','autosave','saveTournamentRelationalV91'];
    names.forEach(function(name){
      const fn = window[name];
      if(typeof fn !== 'function' || fn.__tbkV109Wrapped) return;
      const wrapped = async function(){
        const localState = getAppState();
        if(globalSaveSuppressed()){
          state.lastBlockedSave = { fn: name, at: new Date().toISOString(), reason: 'guard active', domain: state.currentDomain };
          log('save.blocked.guard', state.lastBlockedSave);
          return false;
        }
        if(name === 'saveTournamentRelationalV91' && localState && !hasTournamentData(localState)){
          state.lastBlockedSave = { fn: name, at: new Date().toISOString(), reason: 'empty local tournament state protection' };
          log('save.blocked.empty-tournament', state.lastBlockedSave);
          return false;
        }
        return await fn.apply(this, arguments);
      };
      wrapped.__tbkV109Wrapped = true;
      wrapped.__tbkV109Original = fn;
      window[name] = wrapped;
      log('wrap.save', { name });
    });
  }

  function wrapRealtime(){
    ['startRealtimeV94','loadTournamentScoresRelationalV92','loadTournamentRelationalV91','loadTournamentPlanningRelationalV93'].forEach(function(name){
      const fn = window[name];
      if(typeof fn !== 'function' || fn.__tbkV109Wrapped) return;
      const wrapped = async function(){
        if(realtimeSuppressed()){
          log('realtime.blocked.guard', { fn: name, pausedUntil: state.suppressRealtimeUntil || window.TBK_REALTIME_PAUSED_UNTIL });
          return false;
        }
        return await fn.apply(this, arguments);
      };
      wrapped.__tbkV109Wrapped = true;
      wrapped.__tbkV109Original = fn;
      window[name] = wrapped;
      log('wrap.realtime', { name });
    });
  }

  function detectDomainFromElement(el){
    if(!el) return null;
    const root = el.closest && el.closest('[id], .tab-content, section, main, form, table');
    const text = ((root && (root.id || root.className || root.getAttribute('data-page') || '')) + ' ' + (document.body && document.body.className || '')).toLowerCase();
    if(text.includes('emarg') || text.includes('checkin')) return 'emargement';
    if(text.includes('planning')) return 'planning';
    if(text.includes('inscription')) return 'inscriptions';
    if(text.includes('dm') || text.includes('dh') || text.includes('tournoi')) return 'tournoi';
    return null;
  }

  function installUiGuards(){
    document.addEventListener('input', function(ev){
      const domain = detectDomainFromElement(ev.target);
      if(domain) enterDomain(domain, domain === 'emargement' ? 4500 : 2500);
    }, true);
    document.addEventListener('change', function(ev){
      const domain = detectDomainFromElement(ev.target);
      if(domain) enterDomain(domain, domain === 'emargement' ? 5000 : 3000);
    }, true);
    log('ui.guards.installed');
  }

  function stableRenderAll(){
    const fn = window.renderAll;
    if(typeof fn !== 'function' || fn.__tbkV109Wrapped) return;
    const wrapped = function(){
      if(globalSaveSuppressed()){
        try { return fn.call(this, true); } catch(e) { return fn.apply(this, arguments); }
      }
      return fn.apply(this, arguments);
    };
    wrapped.__tbkV109Wrapped = true;
    wrapped.__tbkV109Original = fn;
    window.renderAll = wrapped;
    log('wrap.renderAll');
  }

  function ensureMiniBadge(){
    let b = document.getElementById('tbk-v109-stability-badge');
    if(!b){
      b = document.createElement('div');
      b.id = 'tbk-v109-stability-badge';
      b.style.position = 'fixed';
      b.style.right = '12px';
      b.style.bottom = '12px';
      b.style.zIndex = '99999';
      b.style.padding = '7px 10px';
      b.style.borderRadius = '999px';
      b.style.background = '#f8fafc';
      b.style.border = '1px solid #cbd5e1';
      b.style.fontSize = '12px';
      b.style.fontWeight = '700';
      b.style.color = '#334155';
      b.style.boxShadow = '0 4px 12px rgba(15, 23, 42, 0.12)';
      b.textContent = '🛡️ V109 stable';
      b.title = 'TBK V109 - garde-fous relationnels actifs';
      document.body.appendChild(b);
    }
    return b;
  }

  function updateMiniBadge(type){
    const b = ensureMiniBadge();
    if(type && String(type).includes('blocked')){
      b.textContent = '🛡️ V109 protège';
      b.style.background = '#fff7ed';
      b.style.borderColor = '#fed7aa';
      b.style.color = '#9a3412';
    } else if(type && String(type).includes('error')){
      b.textContent = '⚠️ V109 erreur';
      b.style.background = '#fef2f2';
      b.style.borderColor = '#fecaca';
      b.style.color = '#991b1b';
    } else if(type && String(type).includes('domain')){
      b.textContent = '🟦 V109 saisie';
      b.style.background = '#eff6ff';
      b.style.borderColor = '#bfdbfe';
      b.style.color = '#1d4ed8';
    } else {
      b.textContent = '🛡️ V109 stable';
      b.style.background = '#f8fafc';
      b.style.borderColor = '#cbd5e1';
      b.style.color = '#334155';
    }
  }

  async function tableCount(client, table){
    try{
      const res = await client.from(table).select('*', { count: 'exact', head: true });
      if(res.error) return { table, ok:false, error: res.error.message };
      return { table, ok:true, count: res.count || 0 };
    } catch(e){
      return { table, ok:false, error: e.message || String(e) };
    }
  }

  async function diagnostic(){
    const client = getSupabaseClient();
    const localState = getAppState();
    const tables = [
      'app_users','app_profiles','registrations','registration_columns','registration_settings',
      'tournaments','tournament_competitions','tournament_teams','tournament_team_players',
      'tournament_checkins','tournament_matches','tournament_match_sets','tournament_courts',
      'tournament_court_assignments'
    ];
    const db = client ? await Promise.all(tables.map(t => tableCount(client,t))) : [];
    const result = {
      version: VERSION,
      at: new Date().toISOString(),
      isAdmin: isAdmin(),
      hasSupabaseClient: !!client,
      guards: {
        globalSaveSuppressed: globalSaveSuppressed(),
        realtimeSuppressed: realtimeSuppressed(),
        suppressGlobalSaveUntil: state.suppressGlobalSaveUntil,
        suppressRealtimeUntil: state.suppressRealtimeUntil,
        bulkResetInProgress: !!window.TBK_BULK_RESET_IN_PROGRESS,
        currentDomain: state.currentDomain
      },
      localState: {
        exists: !!localState,
        hasTournamentData: hasTournamentData(localState),
        dmTeams: countObject(localState && localState.dm && localState.dm.teams),
        dhTeams: countObject(localState && localState.dh && localState.dh.teams),
        inscriptions: Array.isArray(localState && localState.inscriptions) ? localState.inscriptions.length : null
      },
      database: db,
      lastBlockedSave: state.lastBlockedSave,
      recentLogs: state.logs.slice(-25)
    };
    state.lastDiagnostics = result;
    try { console.info(LOG_PREFIX + ' diagnostic', result); } catch(e) {}
    return result;
  }

  function openDiagnosticPanel(){
    diagnostic().then(function(d){
      let pre = document.getElementById('tbk-v109-diagnostic-panel');
      if(!pre){
        pre = document.createElement('pre');
        pre.id = 'tbk-v109-diagnostic-panel';
        pre.style.position = 'fixed';
        pre.style.left = '16px';
        pre.style.right = '16px';
        pre.style.bottom = '56px';
        pre.style.maxHeight = '55vh';
        pre.style.overflow = 'auto';
        pre.style.zIndex = '99998';
        pre.style.padding = '14px';
        pre.style.borderRadius = '12px';
        pre.style.background = '#0f172a';
        pre.style.color = '#e2e8f0';
        pre.style.fontSize = '12px';
        pre.style.boxShadow = '0 12px 30px rgba(0,0,0,.30)';
        pre.title = 'Clique pour fermer';
        pre.addEventListener('click', function(){ pre.remove(); });
        document.body.appendChild(pre);
      }
      pre.textContent = JSON.stringify(d, null, 2);
    });
  }

  function installDiagnosticButton(){
    if(document.getElementById('tbk-v109-diagnostic-button')) return;
    const btn = document.createElement('button');
    btn.id = 'tbk-v109-diagnostic-button';
    btn.type = 'button';
    btn.textContent = '🧪 V109';
    btn.title = 'Diagnostic V109 relationnel';
    btn.style.position = 'fixed';
    btn.style.right = '12px';
    btn.style.bottom = '48px';
    btn.style.zIndex = '99999';
    btn.style.padding = '7px 10px';
    btn.style.borderRadius = '999px';
    btn.style.border = '1px solid #93c5fd';
    btn.style.background = '#eff6ff';
    btn.style.color = '#1d4ed8';
    btn.style.fontSize = '12px';
    btn.style.fontWeight = '700';
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', openDiagnosticPanel);
    document.body.appendChild(btn);
  }

  function init(){
    wrapGlobalSave();
    wrapRealtime();
    stableRenderAll();
    installUiGuards();
    ensureMiniBadge();
    installDiagnosticButton();
    window.tbkV109Diagnostic = diagnostic;
    window.tbkV109EnterDomain = enterDomain;
    window.tbkV109LeaveDomain = leaveDomain;
    window.tbkV109Status = function(){ return JSON.parse(JSON.stringify(state)); };
    log('installed', { version: VERSION });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-wrapping tardif utile si des modules sont chargés ou réinitialisés après le DOMContentLoaded.
  setTimeout(function(){ wrapGlobalSave(); wrapRealtime(); stableRenderAll(); ensureMiniBadge(); installDiagnosticButton(); }, 1500);
  setTimeout(function(){ wrapGlobalSave(); wrapRealtime(); stableRenderAll(); ensureMiniBadge(); installDiagnosticButton(); }, 4000);
})();
