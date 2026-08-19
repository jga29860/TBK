/* TBK V74 - module externalise : tbk-v74-07-supabase-relational.js */
/* ============================================================
   V73 - Persistance relationnelle Supabase
   Objectif : les inscriptions sont stockées ligne par ligne dans public.registrations.
   Le snapshot app_state_snapshots reste utilisé uniquement comme sauvegarde globale de secours.
   ============================================================ */
(function(){
  const CONFIG_STORAGE_KEY = 'tbk_supabase_shared_config_v66';
  const REG_TABLE = 'registrations';
  let regClient = null;
  let regSyncTimer = null;
  let regSyncRunning = false;
  let regSyncPending = false;
  let lastRelationalSyncAt = null;

  function regCfg(){
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

  function regLog(level, step, detail){
    if(typeof tbkDebugLog === 'function') tbkDebugLog(level, step, detail);
    try { console.log('[TBK V73]', step, detail || ''); } catch(e) {}
  }

  function regClientFn(){
    if(regClient) return regClient;
    const c = regCfg();
    if(!window.supabase || !c.url || !c.anonKey) return null;
    regClient = window.supabase.createClient(c.url, c.anonKey);
    return regClient;
  }

  async function regConnectDb(){
    const c = regCfg();
    const sb = regClientFn();
    if(!sb) throw new Error('Client Supabase non configuré.');
    if(!c.dbEmail || !c.dbPassword) throw new Error('Compte technique Supabase incomplet.');
    const session = await sb.auth.getSession();
    if(session?.data?.session?.user?.email === c.dbEmail) return session.data.session.user;
    await sb.auth.signOut();
    const { data, error } = await sb.auth.signInWithPassword({ email:c.dbEmail, password:c.dbPassword });
    if(error) throw error;
    return data.user;
  }

  async function regGetSeason(){
    const sb = regClientFn();
    const c = regCfg();
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

  function ensureClientUid(x){
    if(!x.client_uid && !x.clientUid){
      x.client_uid = 'insc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,10);
    }
    if(x.clientUid && !x.client_uid) x.client_uid = x.clientUid;
    if(x.client_uid && !x.clientUid) x.clientUid = x.client_uid;
    return x.client_uid;
  }

  function numberOrNull(v){
    if(v === undefined || v === null || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function rowFromRegistration(x, seasonId, userId){
    const uid = ensureClientUid(x);
    return {
      season_id: seasonId,
      client_uid: uid,
      nom: x.nom || '',
      prenom: x.prenom || '',
      categorie: x.categorie || 'Adulte',
      ufolep: x.ufolep || 'Non',
      whatsapp: x.whatsapp || 'Non',
      sport: x.sport || 'Bad',
      montant_cotisation: numberOrNull(x.montantCotisation),
      cotisation_payee: x.cotisationPayee || 'Non',
      sante: x.sante || 'QS Sport',
      date_certif: x.dateCertif || '',
      telephone: x.telephone || '',
      adresse: x.adresse || '',
      mail: x.mail || '',
      date_naissance: x.dateNaissance || '',
      membre_bureau: x.membreBureau || 'Non',
      custom_fields: x.customFields || {},
      updated_by: userId || null,
      updated_at: new Date().toISOString()
    };
  }

  function registrationFromRow(r){
    return {
      db_id: r.id,
      client_uid: r.client_uid,
      clientUid: r.client_uid,
      nom: r.nom || '',
      prenom: r.prenom || '',
      categorie: r.categorie || 'Adulte',
      ufolep: r.ufolep || 'Non',
      whatsapp: r.whatsapp || 'Non',
      sport: r.sport || 'Bad',
      montantCotisation: r.montant_cotisation === null || r.montant_cotisation === undefined ? '' : String(r.montant_cotisation),
      cotisationPayee: r.cotisation_payee || 'Non',
      sante: r.sante || 'QS Sport',
      dateCertif: r.date_certif || '',
      telephone: r.telephone || '',
      adresse: r.adresse || '',
      mail: r.mail || '',
      dateNaissance: r.date_naissance || '',
      membreBureau: r.membre_bureau || 'Non',
      customFields: r.custom_fields || {}
    };
  }

  function logQuery(operation, table, details){
    const payload = Object.assign({ operation, table, at:new Date().toISOString(), mode:'relationnel V73' }, details || {});
    regLog('info', 'supabase.relational.query', payload);
  }

  async function loadRegistrationsRelational(){
    const sb = regClientFn();
    if(!sb) return false;
    await regConnectDb();
    const season = await regGetSeason();
    logQuery('SELECT', REG_TABLE, {
      reason: 'chargement initial des inscriptions relationnelles',
      filter: { season_id: season.id },
      order: 'created_at asc',
      equivalentSql: 'select * from public.registrations where season_id = <season_id> order by created_at asc;'
    });
    const { data, error } = await sb.from(REG_TABLE).select('*').eq('season_id', season.id).order('created_at', { ascending:true });
    if(error) throw error;
    state.inscriptions = (data || []).map(registrationFromRow);
    localStorage.setItem(STORAGE, JSON.stringify(state));
    regLog('ok','registrations.load',{ count: state.inscriptions.length, table: REG_TABLE });
    return true;
  }

  async function syncRegistrationsRelational(showMessage){
    if(!currentUser || !currentUser()) return false;
    const sb = regClientFn();
    if(!sb){ if(showMessage) alert('Supabase non configuré.'); return false; }
    if(regSyncRunning){ regSyncPending = true; return false; }
    regSyncRunning = true;
    try{
      const user = await regConnectDb();
      const season = await regGetSeason();
      const arr = ensureInscriptions();
      arr.forEach(ensureClientUid);
      const localUids = arr.map(x => x.client_uid).filter(Boolean);

      logQuery('SELECT', REG_TABLE, {
        reason: 'identifier les inscriptions distantes à supprimer ou mettre à jour',
        filter: { season_id: season.id },
        select: 'id, client_uid',
        equivalentSql: 'select id, client_uid from public.registrations where season_id = <season_id>;'
      });
      const existing = await sb.from(REG_TABLE).select('id,client_uid').eq('season_id', season.id);
      if(existing.error) throw existing.error;
      const remoteRows = existing.data || [];
      const toDelete = remoteRows.filter(r => !localUids.includes(r.client_uid)).map(r => r.client_uid);
      if(toDelete.length){
        logQuery('DELETE', REG_TABLE, {
          reason: 'suppression des inscriptions retirées dans l’IHM',
          filter: { season_id: season.id, client_uid_in: toDelete },
          equivalentSql: 'delete from public.registrations where season_id = <season_id> and client_uid in (<uids_supprimés>);'
        });
        const del = await sb.from(REG_TABLE).delete().eq('season_id', season.id).in('client_uid', toDelete);
        if(del.error) throw del.error;
      }

      const rows = arr.map(x => rowFromRegistration(x, season.id, user?.id || null));
      if(rows.length){
        logQuery('UPSERT', REG_TABLE, {
          reason: 'création ou mise à jour ligne par ligne des inscriptions',
          onConflict: 'season_id,client_uid',
          rows: rows.length,
          sample: rows.slice(0, 2).map(r => ({ client_uid:r.client_uid, nom:r.nom, prenom:r.prenom, categorie:r.categorie, cotisation_payee:r.cotisation_payee })),
          equivalentSql: 'insert into public.registrations (...) values (...) on conflict (season_id, client_uid) do update set ... returning id, client_uid;'
        });
        const up = await sb.from(REG_TABLE).upsert(rows, { onConflict:'season_id,client_uid' }).select('id,client_uid');
        if(up.error) throw up.error;
        const idByUid = Object.fromEntries((up.data || []).map(r => [r.client_uid, r.id]));
        arr.forEach(x => { if(idByUid[x.client_uid]) x.db_id = idByUid[x.client_uid]; });
      }

      localStorage.setItem(STORAGE, JSON.stringify(state));
      lastRelationalSyncAt = new Date();
      window.TBK_LAST_RELATIONAL_SYNC = lastRelationalSyncAt;
      regLog('ok','registrations.sync',{ table:REG_TABLE, count:arr.length, deleted:toDelete.length, at:lastRelationalSyncAt.toISOString() });
      if(showMessage) alert('Inscriptions sauvegardées dans la table relationnelle Supabase registrations.');
      return true;
    }catch(e){
      console.error('[TBK V73] Erreur sync registrations', e);
      regLog('error','registrations.sync', e.message || String(e));
      if(showMessage) alert('Erreur sauvegarde relationnelle Supabase : ' + (e.message || e));
      return false;
    }finally{
      regSyncRunning = false;
      if(regSyncPending){ regSyncPending = false; scheduleRelationalSync('pending'); }
    }
  }

  function scheduleRelationalSync(reason){
    if(!currentUser || !currentUser()) return;
    clearTimeout(regSyncTimer);
    regSyncTimer = setTimeout(function(){ syncRegistrationsRelational(false); }, 650);
    regLog('info','registrations.sync.scheduled',{ reason:reason || 'unknown', table:REG_TABLE });
  }

  window.loadRegistrationsRelationalV73 = loadRegistrationsRelational;
  window.syncRegistrationsRelationalV73 = syncRegistrationsRelational;
  window.scheduleRelationalSyncV73 = scheduleRelationalSync;

  // Ajout d'une inscription : client_uid créé immédiatement pour la clé relationnelle unique.
  window.addInscriptionDemo = function(){
    let arr = ensureInscriptions();
    arr.push({
      client_uid:'insc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,10),
      nom:'', prenom:'', categorie:'Adulte', ufolep:'Non', whatsapp:'Non', sport:'Bad',
      montantCotisation:'', cotisationPayee:'Non', sante:'QS Sport', dateCertif:'', telephone:'', adresse:'', mail:'', dateNaissance:'', membreBureau:'Non', customFields:{}
    });
    renderAll(false);
    scheduleRelationalSync('nouvelle inscription');
    switchTab('inscriptions');
  };

  // Suppression d'une inscription : le diff local/remote supprimera la ligne relationnelle distante.
  const originalDeleteInscription = window.deleteInscription;
  window.deleteInscription = function(i){
    if(typeof originalDeleteInscription === 'function'){
      originalDeleteInscription.apply(this, arguments);
      scheduleRelationalSync('suppression inscription');
    }
  };

  // Toute modification d'inscription déclenche une synchronisation relationnelle.
  const originalUpdateInscriptionSoft = window.updateInscriptionSoft;
  if(typeof originalUpdateInscriptionSoft === 'function'){
    window.updateInscriptionSoft = function(){
      const r = originalUpdateInscriptionSoft.apply(this, arguments);
      scheduleRelationalSync('modification cellule inscription');
      return r;
    };
  }

  // On complète le renderAll existant : le snapshot reste backup, registrations devient source relationnelle.
  const previousRenderAllV73 = window.renderAll;
  window.renderAll = function(skipSave){
    const result = previousRenderAllV73.apply(this, arguments);
    if(!skipSave) scheduleRelationalSync('renderAll inscription');
    return result;
  };

  // Bouton Sauvegarder : relationnel + backup snapshot.
  const previousSaveV73 = window.save;
  window.save = async function(){
    localStorage.setItem(STORAGE, JSON.stringify(state));
    await syncRegistrationsRelational(true);
    if(typeof previousSaveV73 === 'function') await previousSaveV73();
  };

  // Chargement relationnel après connexion : remplace state.inscriptions par les lignes registrations.
  setTimeout(async function(){
    try{
      if(currentUser && currentUser()){
        const ok = await loadRegistrationsRelational();
        if(ok){ renderAll(true); updateAuthChrome(); enforceCurrentAccess(); }
      }
    }catch(e){
      console.error('[TBK V73] Erreur chargement relationnel', e);
      regLog('error','registrations.load', e.message || String(e));
    }
  }, 1700);
})();
