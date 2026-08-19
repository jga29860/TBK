/* TBK V94 - Synchronisation temps réel Supabase
   Objectif : rafraichir automatiquement les écrans quand une autre session modifie les données.
   Tables suivies : inscriptions, colonnes, équipes, émargement, matchs, scores, terrains.
*/
(function(){
  const CFG_KEY = 'tbk_supabase_shared_config_v66';
  const DEBOUNCE_MS = 900;
  let clientCache = null;
  let dbUser = null;
  let channel = null;
  let started = false;
  let timers = {};
  let lastEvents = [];

  function isRealtimePaused(){
    return Date.now() < (window.TBK_REALTIME_PAUSED_UNTIL || 0) || !!window.TBK_BULK_RESET_IN_PROGRESS;
  }

  function log(level, step, detail){
    if(typeof tbkDebugLog === 'function') tbkDebugLog(level, step, detail);
    try { console.log('[TBK V94]', step, detail || ''); } catch(e) {}
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

  function rememberEvent(payload, group){
    lastEvents.push({ at:new Date().toISOString(), group, table:payload.table, event:payload.eventType });
    if(lastEvents.length > 30) lastEvents.shift();
  }

  function setRealtimeBadge(text, cls){
    let badge = document.getElementById('tbkRealtimeBadge');
    if(!badge){
      badge = document.createElement('span');
      badge.id = 'tbkRealtimeBadge';
      badge.className = 'auth-zone';
      const auth = document.getElementById('authStatus');
      if(auth && auth.parentNode) auth.parentNode.appendChild(badge);
    }
    badge.textContent = text;
    badge.title = 'Synchronisation temps réel Supabase';
    badge.style.marginLeft = '8px';
    badge.style.fontSize = '12px';
    badge.style.padding = '4px 8px';
    badge.style.borderRadius = '999px';
    badge.style.background = cls === 'ok' ? '#dcfce7' : (cls === 'warn' ? '#fef3c7' : '#fee2e2');
    badge.style.color = cls === 'ok' ? '#166534' : (cls === 'warn' ? '#92400e' : '#991b1b');
  }

  function isConnectedToSite(){
    try { return typeof currentUser === 'function' && !!currentUser(); } catch(e){ return false; }
  }

  function schedule(group, fn){
    if(isRealtimePaused()){
      clearTimeout(timers[group]);
      log('info','realtime.v94.paused',{ group, until: window.TBK_REALTIME_PAUSED_UNTIL || null });
      setRealtimeBadge('⏸ Temps réel en pause', 'warn');
      return;
    }
    rememberEvent({ table:group, eventType:'debounced' }, group);
    clearTimeout(timers[group]);
    timers[group] = setTimeout(async function(){
      if(!isConnectedToSite()) return;
      if(isRealtimePaused()){ setRealtimeBadge('⏸ Temps réel en pause', 'warn'); return; }
      try{
        setRealtimeBadge('🔄 Sync...', 'warn');
        await fn();
        if(typeof renderAll === 'function') renderAll(true);
        if(typeof updateAuthChrome === 'function') updateAuthChrome();
        if(typeof enforceCurrentAccess === 'function') enforceCurrentAccess();
        setRealtimeBadge('🟢 Temps réel', 'ok');
        log('ok','realtime.v94.refresh',{ group, lastEvents });
      }catch(e){
        console.warn('[TBK V94] Erreur rafraichissement realtime', group, e);
        setRealtimeBadge('⚠ Sync erreur', 'error');
        log('error','realtime.v94.refresh',{ group, error:e.message || String(e) });
      }
    }, DEBOUNCE_MS);
  }

  async function refreshRegistrations(){
    if(typeof reloadRegistrationColumnsFromDb === 'function') await reloadRegistrationColumnsFromDb();
    if(typeof loadRegistrationsRelationalV73 === 'function') await loadRegistrationsRelationalV73();
  }

  async function refreshTournamentStructure(){
    if(typeof loadTournamentRelationalV91 === 'function') await loadTournamentRelationalV91();
  }

  async function refreshScores(){
    if(typeof loadTournamentScoresRelationalV92 === 'function') await loadTournamentScoresRelationalV92();
  }

  async function refreshPlanning(){
    if(typeof loadTournamentPlanningRelationalV93 === 'function') await loadTournamentPlanningRelationalV93();
  }

  function handleChange(group, payload){
    if(isRealtimePaused()){
      log('info','realtime.v94.event.ignored.pause',{ group, table:payload.table, event:payload.eventType });
      setRealtimeBadge('⏸ Temps réel en pause', 'warn');
      return;
    }
    rememberEvent(payload, group);
    log('info','realtime.v94.event',{ group, table:payload.table, event:payload.eventType });
    if(group === 'registrations') schedule(group, refreshRegistrations);
    else if(group === 'structure') schedule(group, refreshTournamentStructure);
    else if(group === 'scores') schedule(group, refreshScores);
    else if(group === 'planning') schedule(group, refreshPlanning);
  }

  const subscriptions = [
    { group:'registrations', table:'registrations' },
    { group:'registrations', table:'registration_columns' },
    { group:'registrations', table:'registration_column_options' },
    { group:'registrations', table:'registration_custom_values' },

    { group:'structure', table:'tournaments' },
    { group:'structure', table:'tournament_competitions' },
    { group:'structure', table:'tournament_pools' },
    { group:'structure', table:'tournament_teams' },
    { group:'structure', table:'tournament_team_players' },
    { group:'structure', table:'tournament_checkins' },

    { group:'scores', table:'tournament_matches' },
    { group:'scores', table:'tournament_match_sets' },

    { group:'planning', table:'tournament_courts' },
    { group:'planning', table:'tournament_court_assignments' }
  ];

  async function startRealtimeV94(){
    if(isRealtimePaused()){ setRealtimeBadge('⏸ Temps réel en pause', 'warn'); return false; }
    if(started) return true;
    const client = sb();
    if(!client){ setRealtimeBadge('🔴 Pas de Supabase', 'error'); return false; }
    if(!isConnectedToSite()) return false;
    await connectDb();

    if(channel){
      try { await client.removeChannel(channel); } catch(e) {}
      channel = null;
    }

    channel = client.channel('tbk-v94-realtime-sync');
    subscriptions.forEach(s => {
      channel.on('postgres_changes', { event:'*', schema:'public', table:s.table }, payload => handleChange(s.group, payload));
    });

    channel.subscribe(status => {
      log(status === 'SUBSCRIBED' ? 'ok' : 'info', 'realtime.v94.status', status);
      if(status === 'SUBSCRIBED'){
        started = true;
        setRealtimeBadge('🟢 Temps réel', 'ok');
      } else if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'){
        started = false;
        setRealtimeBadge('🔴 Temps réel KO', 'error');
      } else {
        setRealtimeBadge('🟡 Temps réel...', 'warn');
      }
    });
    return true;
  }

  async function stopRealtimeV94(){
    const client = sb();
    if(client && channel){
      try { await client.removeChannel(channel); } catch(e) {}
    }
    channel = null;
    started = false;
    setRealtimeBadge('⚪ Temps réel arrêté', 'warn');
  }

  window.startRealtimeV94 = startRealtimeV94;
  window.stopRealtimeV94 = stopRealtimeV94;
  window.tbkRealtimeV94Status = function(){ return { started, lastEvents:[...lastEvents] }; };

  // Démarrage automatique après authentification et chargements relationnels.
  setTimeout(function(){
    startRealtimeV94().catch(e => {
      console.warn('[TBK V94] Démarrage realtime impossible', e);
      setRealtimeBadge('⚠ Realtime inactif', 'warn');
      log('error','realtime.v94.start', e.message || String(e));
    });
  }, 5600);

  window.addEventListener('beforeunload', function(){
    try { stopRealtimeV94(); } catch(e) {}
  });
})();
