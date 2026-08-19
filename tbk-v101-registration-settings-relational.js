/* TBK V101 - Parametres de cotisation inscriptions en base relationnelle
   Table source : public.registration_settings
   Objectif : cotisationAdulte, cotisationJeune, supplementBadPing,
   supplementUfolep et reductionBureau ne dependent plus du snapshot/localStorage.
*/
(function(){
  const CONFIG_STORAGE_KEY = 'tbk_supabase_shared_config_v66';
  const SETTINGS_TABLE = 'registration_settings';
  let clientCache = null;
  let saving = false;
  let pending = false;

  const DEFAULTS = {
    cotisationAdulte: 40,
    cotisationJeune: 30,
    supplementBadPing: 10,
    supplementUfolep: 20,
    reductionBureau: 10
  };

  const DB_FIELDS = {
    cotisationAdulte: 'cotisation_adulte',
    cotisationJeune: 'cotisation_jeune',
    supplementBadPing: 'supplement_bad_ping',
    supplementUfolep: 'supplement_ufolep',
    reductionBureau: 'reduction_bureau'
  };

  const JS_FIELDS = Object.fromEntries(Object.entries(DB_FIELDS).map(([k,v]) => [v,k]));

  function log(level, step, detail){
    try { if(typeof tbkDebugLog === 'function') tbkDebugLog(level, step, detail); } catch(e) {}
    try { console.log('[TBK V101]', step, detail || ''); } catch(e) {}
  }

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
    if(session?.data?.session?.user?.email === c.dbEmail) return session.data.session.user;
    await client.auth.signOut();
    const { data, error } = await client.auth.signInWithPassword({ email:c.dbEmail, password:c.dbPassword });
    if(error) throw error;
    return data.user;
  }

  async function getSeason(){
    const client = sb();
    const c = cfg();
    let res = await client.from('club_seasons').select('id,label,active').eq('label', c.seasonLabel).maybeSingle();
    if(res.error) throw res.error;
    if(res.data) return res.data;
    res = await client.from('club_seasons').select('id,label,active').eq('active', true).limit(1).maybeSingle();
    if(res.error) throw res.error;
    if(!res.data) throw new Error('Saison Supabase introuvable.');
    return res.data;
  }

  function ensureLocalSettings(){
    if(typeof ensureInscriptionSettings === 'function') return ensureInscriptionSettings();
    state.inscriptionSettings = state.inscriptionSettings || {};
    return state.inscriptionSettings;
  }

  function normalizeAmount(v, fallback){
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  function localSettingsPayload(seasonId, userId){
    const s = Object.assign({}, DEFAULTS, ensureLocalSettings());
    return {
      season_id: seasonId,
      cotisation_adulte: normalizeAmount(s.cotisationAdulte, DEFAULTS.cotisationAdulte),
      cotisation_jeune: normalizeAmount(s.cotisationJeune, DEFAULTS.cotisationJeune),
      supplement_bad_ping: normalizeAmount(s.supplementBadPing, DEFAULTS.supplementBadPing),
      supplement_ufolep: normalizeAmount(s.supplementUfolep, DEFAULTS.supplementUfolep),
      reduction_bureau: normalizeAmount(s.reductionBureau, DEFAULTS.reductionBureau),
      updated_by: userId || null,
      updated_at: new Date().toISOString()
    };
  }

  function applyRowToLocal(row){
    const s = ensureLocalSettings();
    Object.entries(JS_FIELDS).forEach(([dbField, jsField]) => {
      if(row[dbField] !== undefined && row[dbField] !== null) s[jsField] = Number(row[dbField]);
    });
    state.inscriptionSettings = s;
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch(e) {}
    return s;
  }

  async function loadRegistrationSettingsV101(options){
    const opts = options || {};
    const client = sb();
    if(!client) return false;
    await connectDb();
    const season = await getSeason();
    const res = await client.from(SETTINGS_TABLE).select('*').eq('season_id', season.id).maybeSingle();
    if(res.error) throw res.error;
    if(!res.data){
      const user = await connectDb();
      const payload = localSettingsPayload(season.id, user?.id || null);
      const ins = await client.from(SETTINGS_TABLE).insert(payload).select('*').maybeSingle();
      if(ins.error) throw ins.error;
      applyRowToLocal(ins.data || payload);
      log('ok','registration_settings.init',{ table:SETTINGS_TABLE, season:season.label, payload });
    } else {
      applyRowToLocal(res.data);
      log('ok','registration_settings.load',{ table:SETTINGS_TABLE, season:season.label, settings:res.data });
    }
    if(opts.render !== false && typeof renderAll === 'function'){
      try { renderAll(true); } catch(e) {}
      try { if(typeof updateAuthChrome === 'function') updateAuthChrome(); } catch(e) {}
      try { if(typeof enforceCurrentAccess === 'function') enforceCurrentAccess(); } catch(e) {}
    }
    return true;
  }

  async function saveRegistrationSettingsV101(showMessage){
    if(!currentUser || !currentUser()) return false;
    const client = sb();
    if(!client){ if(showMessage) alert('Supabase non configuré.'); return false; }
    if(saving){ pending = true; return false; }
    saving = true;
    try{
      const user = await connectDb();
      const season = await getSeason();
      const payload = localSettingsPayload(season.id, user?.id || null);
      const up = await client.from(SETTINGS_TABLE).upsert(payload, { onConflict:'season_id' }).select('*').maybeSingle();
      if(up.error) throw up.error;
      applyRowToLocal(up.data || payload);
      log('ok','registration_settings.save',{ table:SETTINGS_TABLE, season:season.label, payload });
      if(showMessage) alert('Paramètres de cotisation sauvegardés dans registration_settings.');
      return true;
    }catch(e){
      console.error('[TBK V101] Erreur sauvegarde paramètres cotisation', e);
      log('error','registration_settings.save', e.message || String(e));
      if(showMessage) alert('Erreur sauvegarde paramètres cotisation : ' + (e.message || e));
      return false;
    }finally{
      saving = false;
      if(pending){ pending = false; setTimeout(() => saveRegistrationSettingsV101(false), 250); }
    }
  }

  window.loadRegistrationSettingsV101 = loadRegistrationSettingsV101;
  window.saveRegistrationSettingsV101 = saveRegistrationSettingsV101;

  window.updateInscriptionSetting = function(field, value){
    const s = ensureLocalSettings();
    s[field] = normalizeAmount(value, DEFAULTS[field] ?? 0);
    state.inscriptionSettings = s;
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch(e) {}
    if(typeof renderAll === 'function') renderAll(false);
    if(typeof switchTab === 'function') switchTab('inscriptions');
    saveRegistrationSettingsV101(false);
    return true;
  };

  const previousSave = window.save;
  window.save = async function(){
    try { await saveRegistrationSettingsV101(false); } catch(e) { console.warn('[TBK V101] save settings skipped', e); }
    if(typeof previousSave === 'function') return await previousSave.apply(this, arguments);
  };

  setTimeout(async function(){
    try{
      if(typeof currentUser === 'function' && currentUser()){
        await loadRegistrationSettingsV101({ render:true });
      }
    }catch(e){
      console.error('[TBK V101] Erreur chargement paramètres cotisation', e);
      log('error','registration_settings.load', e.message || String(e));
    }
  }, 2300);
})();
