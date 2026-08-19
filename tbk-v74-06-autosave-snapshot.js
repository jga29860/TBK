/* TBK V74 - module externalise : tbk-v74-06-autosave-snapshot.js */
/* ============================================================
   V71 - Sauvegarde automatique Supabase de toutes les modifications IHM
   - Toute action qui appelle renderAll(false) déclenche une sauvegarde distante.
   - Tout changement dans un input/select/textarea applicatif déclenche une sauvegarde distante.
   - Les fonctions d'administration utilisateurs/profils/colonnes déclenchent aussi une sauvegarde.
   - Snapshot enrichi : état tournoi + inscriptions + colonnes + profils + utilisateurs + largeurs colonnes.
   ============================================================ */
(function(){
  const CONFIG_STORAGE_KEY = 'tbk_supabase_shared_config_v66';
  const SNAPSHOT_NAME = 'current_state';
  const AUTOSAVE_DELAY_MS = 900;
  let autosaveTimer = null;
  let autosaveRunning = false;
  let autosavePending = false;
  let latestSnapshotId = null;
  let lastAutosaveAt = null;
  let v71Client = null;

  function cfg(){
    let local = {};
    try { local = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || '{}'); } catch(e) { local = {}; }
    const globalCfg = window.TBK_SUPABASE_CONFIG || {};
    return {
      url: local.url || globalCfg.url || '',
      anonKey: local.anonKey || globalCfg.anonKey || '',
      dbEmail: local.dbEmail || globalCfg.dbEmail || '',
      dbPassword: local.dbPassword || globalCfg.dbPassword || '',
      seasonLabel: local.seasonLabel || globalCfg.seasonLabel || '2026-2027'
    };
  }

  function client(){
    if(v71Client) return v71Client;
    const c = cfg();
    if(!window.supabase || !c.url || !c.anonKey) return null;
    v71Client = window.supabase.createClient(c.url, c.anonKey);
    return v71Client;
  }

  async function connectDb(){
    const c = cfg();
    const sb = client();
    if(!sb) throw new Error('Client Supabase non configuré.');
    if(!c.dbEmail || !c.dbPassword) throw new Error('Compte technique Supabase incomplet.');
    const session = await sb.auth.getSession();
    if(session?.data?.session?.user?.email === c.dbEmail) return session.data.session.user;
    await sb.auth.signOut();
    const { data, error } = await sb.auth.signInWithPassword({ email:c.dbEmail, password:c.dbPassword });
    if(error) throw error;
    return data.user;
  }

  async function getSeason(){
    const sb = client();
    const c = cfg();
    let { data, error } = await sb.from('club_seasons').select('id,label,active').eq('label', c.seasonLabel).maybeSingle();
    if(error) throw error;
    if(!data){
      const fallback = await sb.from('club_seasons').select('id,label,active').eq('active', true).limit(1).maybeSingle();
      if(fallback.error) throw fallback.error;
      data = fallback.data;
    }
    if(!data) throw new Error('Saison Supabase introuvable.');
    return data;
  }

  function getJsonFromLs(key, fallback){
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch(e) { return fallback; }
  }

  function payload(){
    let inscriptionColumns = [];
    try { inscriptionColumns = getInscriptionColumns(); } catch(e) { inscriptionColumns = []; }
    let authUsers = [];
    try { authUsers = getAuthUsers(); } catch(e) { authUsers = getJsonFromLs('tbk_auth_users_v49', []); }
    let authProfiles = {};
    try { authProfiles = getAuthProfiles(); } catch(e) { authProfiles = getJsonFromLs('tbk_auth_profiles_v49', {}); }
    return {
      appVersion: 'V71',
      savedAt: new Date().toISOString(),
      savedBySiteUser: (typeof currentUser === 'function') ? currentUser() : null,
      state: state,
      inscriptionColumns: inscriptionColumns,
      authUsers: authUsers,
      authProfiles: authProfiles,
      columnWidths: getJsonFromLs('tbk_column_widths_v41', {}),
      adminMode: localStorage.getItem('tbk_admin_mode') || '0'
    };
  }

  function restoreExtendedPayload(p){
    if(!p || typeof p !== 'object') return;
    if(p.state && p.state.dm && p.state.dh){ state = p.state; localStorage.setItem(STORAGE, JSON.stringify(state)); }
    if(Array.isArray(p.inscriptionColumns)) localStorage.setItem(INSC_COLUMNS_STORAGE, JSON.stringify(p.inscriptionColumns));
    if(Array.isArray(p.authUsers)) localStorage.setItem(TBK_USERS_STORAGE, JSON.stringify(p.authUsers));
    if(p.authProfiles && typeof p.authProfiles === 'object') localStorage.setItem(TBK_PROFILES_STORAGE, JSON.stringify(p.authProfiles));
    if(p.columnWidths && typeof p.columnWidths === 'object') localStorage.setItem(COLUMN_WIDTHS_STORAGE, JSON.stringify(p.columnWidths));
    if(p.adminMode !== undefined && p.adminMode !== null) localStorage.setItem('tbk_admin_mode', String(p.adminMode));
  }

  async function loadExtendedSnapshot(){
    const sb = client();
    if(!sb) return false;
    await connectDb();
    const season = await getSeason();
    const { data, error } = await sb.from('app_state_snapshots')
      .select('id,data_json,created_at')
      .eq('season_id', season.id)
      .eq('snapshot_name', SNAPSHOT_NAME)
      .order('created_at', { ascending:false })
      .limit(1);
    if(error) throw error;
    if(!data || !data.length) return false;
    latestSnapshotId = data[0].id;
    restoreExtendedPayload(data[0].data_json || {});
    return true;
  }

  function logSupabaseQueryV72(operation, table, details){
    const payload = Object.assign({
      operation: operation,
      table: table,
      at: new Date().toISOString()
    }, details || {});
    if(typeof tbkDebugLog === 'function') tbkDebugLog('info','supabase.query', payload);
    try { console.log('[TBK Supabase Query]', payload); } catch(e) {}
  }

  function payloadSummaryV72(dataJson){
    const st = dataJson && dataJson.state ? dataJson.state : {};
    return {
      appVersion: dataJson?.appVersion,
      savedAt: dataJson?.savedAt,
      savedBySiteUser: dataJson?.savedBySiteUser?.login || null,
      registrations: Array.isArray(st.inscriptions) ? st.inscriptions.length : 0,
      dmTeams: st.dm?.teams ? st.dm.teams.length : 0,
      dhTeams: st.dh?.teams ? st.dh.teams.length : 0,
      dmMatches: st.dm?.matches ? st.dm.matches.length : 0,
      dhMatches: st.dh?.matches ? st.dh.matches.length : 0,
      inscriptionColumns: Array.isArray(dataJson?.inscriptionColumns) ? dataJson.inscriptionColumns.length : 0,
      authUsers: Array.isArray(dataJson?.authUsers) ? dataJson.authUsers.length : 0,
      authProfiles: dataJson?.authProfiles ? Object.keys(dataJson.authProfiles).length : 0
    };
  }

  async function saveExtendedSnapshot(showMessage){
    const sb = client();
    if(!sb) { if(showMessage) alert('Supabase non configuré.'); return false; }
    const user = await connectDb();
    const season = await getSeason();
    const dataJson = payload();
    const summary = payloadSummaryV72(dataJson);
    let res;
    if(latestSnapshotId){
      logSupabaseQueryV72('UPDATE', 'app_state_snapshots', {
        reason: 'modification IHM - autosave snapshot existant',
        filter: { id: latestSnapshotId },
        select: 'id',
        updateFields: ['data_json'],
        payloadSummary: summary,
        equivalentSql: 'update public.app_state_snapshots set data_json = <snapshot> where id = <latestSnapshotId> returning id;'
      });
      res = await sb.from('app_state_snapshots')
        .update({ data_json:dataJson })
        .eq('id', latestSnapshotId)
        .select('id')
        .maybeSingle();
    } else {
      logSupabaseQueryV72('SELECT', 'app_state_snapshots', {
        reason: 'recherche snapshot current_state avant insertion/update',
        filter: { season_id: season.id, snapshot_name: SNAPSHOT_NAME },
        select: 'id',
        order: 'created_at desc',
        limit: 1,
        equivalentSql: 'select id from public.app_state_snapshots where season_id = <season_id> and snapshot_name = current_state order by created_at desc limit 1;'
      });
      const existing = await sb.from('app_state_snapshots')
        .select('id')
        .eq('season_id', season.id)
        .eq('snapshot_name', SNAPSHOT_NAME)
        .order('created_at', { ascending:false })
        .limit(1);
      if(existing.error) throw existing.error;
      if(existing.data && existing.data.length){
        latestSnapshotId = existing.data[0].id;
        logSupabaseQueryV72('UPDATE', 'app_state_snapshots', {
          reason: 'modification IHM - autosave après recherche snapshot existant',
          filter: { id: latestSnapshotId },
          select: 'id',
          updateFields: ['data_json'],
          payloadSummary: summary,
          equivalentSql: 'update public.app_state_snapshots set data_json = <snapshot> where id = <latestSnapshotId> returning id;'
        });
        res = await sb.from('app_state_snapshots')
          .update({ data_json:dataJson })
          .eq('id', latestSnapshotId)
          .select('id')
          .maybeSingle();
      } else {
        logSupabaseQueryV72('INSERT', 'app_state_snapshots', {
          reason: 'modification IHM - création du premier snapshot current_state',
          insertFields: ['season_id','snapshot_name','data_json','created_by'],
          select: 'id',
          values: { season_id: season.id, snapshot_name: SNAPSHOT_NAME, created_by: user?.id || null },
          payloadSummary: summary,
          equivalentSql: 'insert into public.app_state_snapshots (season_id, snapshot_name, data_json, created_by) values (<season_id>, current_state, <snapshot>, <user_id>) returning id;'
        });
        res = await sb.from('app_state_snapshots')
          .insert({ season_id:season.id, snapshot_name:SNAPSHOT_NAME, data_json:dataJson, created_by:user?.id || null })
          .select('id')
          .maybeSingle();
      }
    }
    if(res.error) throw res.error;
    if(res.data?.id) latestSnapshotId = res.data.id;
    lastAutosaveAt = new Date();
    window.TBK_LAST_SUPABASE_AUTOSAVE = lastAutosaveAt;
    if(showMessage) alert('Données sauvegardées dans Supabase.');
    if(typeof tbkDebugLog === 'function') tbkDebugLog('ok','autosave.supabase',{at:lastAutosaveAt.toISOString(), snapshotId:latestSnapshotId});
    return true;
  }

  async function runAutosave(showMessage){
    if(!currentUser || !currentUser()) return false;
    if(autosaveRunning){ autosavePending = true; return false; }
    autosaveRunning = true;
    try { return await saveExtendedSnapshot(showMessage); }
    catch(e){
      console.error('[TBK V71] Erreur autosave Supabase', e);
      if(typeof tbkDebugLog === 'function') tbkDebugLog('error','autosave.supabase', e.message || String(e));
      if(showMessage) alert('Erreur sauvegarde Supabase : ' + (e.message || e));
      return false;
    } finally {
      autosaveRunning = false;
      if(autosavePending){ autosavePending = false; scheduleAutosave('pending'); }
    }
  }

  function scheduleAutosave(reason){
    if(!currentUser || !currentUser()) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function(){ runAutosave(false); }, AUTOSAVE_DELAY_MS);
    if(typeof tbkDebugLog === 'function') tbkDebugLog('info','autosave.scheduled',{reason:reason || 'unknown'});
  }
  window.scheduleSupabaseAutosaveV71 = scheduleAutosave;
  window.saveExtendedSnapshotV71 = saveExtendedSnapshot;
  window.loadExtendedSnapshotV71 = loadExtendedSnapshot;

  // Bouton Sauvegarder : sauvegarde forcée immédiate.
  window.save = async function(){
    localStorage.setItem(STORAGE, JSON.stringify(state));
    await runAutosave(true);
  };

  // Compatibilité avec le mode debug V68.
  window.saveRemoteStateV66 = async function(showMessage){ return await saveExtendedSnapshot(showMessage); };

  // Toutes les fonctions qui rendent l'IHM après modification déclenchent une autosave.
  const originalRenderAll = window.renderAll;
  window.renderAll = function(skipSave){
    const result = originalRenderAll.apply(this, arguments);
    if(!skipSave){
      try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch(e) {}
      scheduleAutosave('renderAll');
    }
    return result;
  };

  // Toutes les modifications directes dans les champs applicatifs déclenchent aussi une autosave.
  document.addEventListener('change', function(e){
    const el = e.target;
    if(!el || !el.closest) return;
    if(el.closest('#login') || el.closest('.supabase-debug-panel') || el.closest('.supabase-debug-card')) return;
    if(el.type === 'search') return;
    if(el.id === 'importFile') return;
    scheduleAutosave('field.change');
  }, true);

  // Certaines saisies utilisent onchange soft et localStorage : on sécurise aussi la sortie de champ.
  document.addEventListener('blur', function(e){
    const el = e.target;
    if(!el || !el.matches || !el.matches('input,select,textarea')) return;
    if(el.closest('#login') || el.closest('.supabase-debug-panel') || el.closest('.supabase-debug-card')) return;
    if(el.type === 'search') return;
    scheduleAutosave('field.blur');
  }, true);

  // Fonctions d'administration : persistance distante après modification utilisateurs/profils/colonnes.
  ['saveAuthUsers','saveAuthProfiles','saveInscriptionColumns','setColumnWidths'].forEach(function(fn){
    const old = window[fn];
    if(typeof old === 'function'){
      window[fn] = function(){
        const r = old.apply(this, arguments);
        scheduleAutosave(fn);
        return r;
      };
    }
  });

  // Chargement enrichi après le boot existant, puis rendu pour appliquer profils/colonnes récupérés.
  setTimeout(async function(){
    try{
      if(currentUser && currentUser()){
        const loaded = await loadExtendedSnapshot();
        if(loaded){
          renderAll(true);
          updateAuthChrome();
          enforceCurrentAccess();
          if(typeof tbkDebugLog === 'function') tbkDebugLog('ok','extended.load','Snapshot enrichi chargé.');
        }
      }
    }catch(e){
      console.error('[TBK V71] Erreur chargement snapshot enrichi', e);
      if(typeof tbkDebugLog === 'function') tbkDebugLog('error','extended.load', e.message || String(e));
    }
  }, 1200);

  // Dernière tentative lorsque l'utilisateur quitte la page.
  window.addEventListener('beforeunload', function(){
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch(e) {}
    if(currentUser && currentUser()){
      // fire-and-forget : le navigateur peut interrompre, mais les sauvegardes debounced ont déjà couvert les changements.
      saveExtendedSnapshot(false);
    }
  });
})();
