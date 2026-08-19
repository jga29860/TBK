/* TBK V74 - module externalise : tbk-v74-04-supabase-shared-auth.js */
/* ============================================================
   V66 - Connexion Supabase commune pour tous les utilisateurs du site
   - Connexion utilisateur du site : identifiants internes existants.
   - Connexion base Supabase : compte technique commun unique.
   - Droits d'interface : profils et droits paramétrés dans le site.
   - Persistance : état complet dans app_state_snapshots/current_state.
   ============================================================ */
(function(){
  const V66_CONFIG_KEY = 'tbk_supabase_shared_config_v66';
  const V66_SNAPSHOT_NAME = 'current_state';
  let v66Client = null;
  let v66Season = null;
  let v66SnapshotId = null;
  let v66LastSave = null;

  function getV66Config(){
    let local = {};
    try { local = JSON.parse(localStorage.getItem(V66_CONFIG_KEY) || '{}'); } catch(e) { local = {}; }
    const globalCfg = window.TBK_SUPABASE_CONFIG || {};
    return {
      url: local.url || globalCfg.url || '',
      anonKey: local.anonKey || globalCfg.anonKey || '',
      dbEmail: local.dbEmail || globalCfg.dbEmail || '',
      dbPassword: local.dbPassword || globalCfg.dbPassword || '',
      seasonLabel: local.seasonLabel || globalCfg.seasonLabel || '2026-2027'
    };
  }

  function saveV66Config(){
    const url = (document.getElementById('supabaseUrl')?.value || '').trim();
    const anonKey = (document.getElementById('supabaseAnonKey')?.value || '').trim();
    const dbEmail = (document.getElementById('supabaseDbEmail')?.value || '').trim();
    const dbPassword = document.getElementById('supabaseDbPassword')?.value || '';
    const seasonLabel = (document.getElementById('supabaseSeason')?.value || '2026-2027').trim();
    if(!url || !anonKey || !dbEmail || !dbPassword){
      alert('URL Supabase, clé anon, email technique et mot de passe technique sont obligatoires.');
      return;
    }
    localStorage.setItem(V66_CONFIG_KEY, JSON.stringify({url, anonKey, dbEmail, dbPassword, seasonLabel}));
    alert('Configuration Supabase commune enregistrée dans ce navigateur. Recharge de la page.');
    location.reload();
  }
  window.saveV66Config = saveV66Config;

  function v66Supa(){
    if(v66Client) return v66Client;
    const cfg = getV66Config();
    if(!cfg.url || !cfg.anonKey || !window.supabase) return null;
    v66Client = window.supabase.createClient(cfg.url, cfg.anonKey);
    return v66Client;
  }

  async function connectSharedDatabase(){
    const cfg = getV66Config();
    const client = v66Supa();
    if(!client) throw new Error('Configuration Supabase absente.');
    if(!cfg.dbEmail || !cfg.dbPassword) throw new Error('Compte technique Supabase non renseigné.');
    const current = await client.auth.getSession();
    if(current?.data?.session?.user?.email === cfg.dbEmail) return current.data.session.user;
    await client.auth.signOut();
    const { data, error } = await client.auth.signInWithPassword({ email: cfg.dbEmail, password: cfg.dbPassword });
    if(error) throw error;
    return data.user;
  }

  async function loadSeason(){
    const client = v66Supa();
    const cfg = getV66Config();
    let { data, error } = await client.from('club_seasons').select('*').eq('label', cfg.seasonLabel).maybeSingle();
    if(error) throw error;
    if(!data){
      const fallback = await client.from('club_seasons').select('*').eq('active', true).limit(1).maybeSingle();
      if(fallback.error) throw fallback.error;
      data = fallback.data;
    }
    if(!data) throw new Error('Saison Supabase introuvable.');
    v66Season = data;
    return data;
  }

  function packState(){
    let columns = [];
    try { columns = getInscriptionColumns(); } catch(e) { columns = []; }
    return { appVersion:'V66', savedAt:new Date().toISOString(), savedBySiteUser:currentUser(), state, inscriptionColumns:columns };
  }

  function unpackState(payload){
    if(!payload) return false;
    const remoteState = payload.state || payload;
    if(!remoteState || !remoteState.dm || !remoteState.dh) return false;
    state = remoteState;
    if(Array.isArray(payload.inscriptionColumns)) localStorage.setItem(INSC_COLUMNS_STORAGE, JSON.stringify(payload.inscriptionColumns));
    localStorage.setItem(STORAGE, JSON.stringify(state));
    return true;
  }

  async function loadRemoteState(){
    const client = v66Supa();
    const season = v66Season || await loadSeason();
    const { data, error } = await client
      .from('app_state_snapshots')
      .select('id,data_json,created_at')
      .eq('season_id', season.id)
      .eq('snapshot_name', V66_SNAPSHOT_NAME)
      .order('created_at', { ascending:false })
      .limit(1);
    if(error) throw error;
    if(!data || !data.length) return false;
    v66SnapshotId = data[0].id;
    return unpackState(data[0].data_json);
  }

  async function saveRemoteState(showMessage){
    const client = v66Supa();
    if(!client){ if(showMessage) alert('Supabase non configuré : sauvegarde locale uniquement.'); return false; }
    await connectSharedDatabase();
    const season = v66Season || await loadSeason();
    const payload = packState();
    let res;
    if(v66SnapshotId){
      res = await client.from('app_state_snapshots').update({ data_json: payload }).eq('id', v66SnapshotId).select('id').maybeSingle();
    } else {
      const userRes = await client.auth.getUser();
      res = await client.from('app_state_snapshots').insert({ season_id: season.id, snapshot_name: V66_SNAPSHOT_NAME, data_json: payload, created_by: userRes?.data?.user?.id || null }).select('id').maybeSingle();
    }
    if(res.error) throw res.error;
    if(res.data?.id) v66SnapshotId = res.data.id;
    v66LastSave = new Date();
    if(showMessage) alert('Données sauvegardées dans Supabase avec le compte technique commun.');
    return true;
  }
  window.saveRemoteStateV66 = saveRemoteState;

  window.save = async function(){
    localStorage.setItem(STORAGE, JSON.stringify(state));
    try { await saveRemoteState(true); }
    catch(e){ console.error(e); alert('Erreur sauvegarde Supabase : ' + (e.message || e) + '\nLes données restent sauvegardées localement.'); }
  };

  window.renderLogin = function(){
    const el = document.getElementById('login');
    if(!el) return;
    const cfg = getV66Config();
    const configured = !!(cfg.url && cfg.anonKey && cfg.dbEmail && cfg.dbPassword);
    const configBlock = configured ? `
      <div class="login-help"><b>Base Supabase :</b> configuration forcée depuis tbk-supabase-config.js pour <b>${esc(cfg.seasonLabel)}</b><br>
      Compte technique : <b>${esc(cfg.dbEmail)}</b><br>
      <button type="button" class="secondary" onclick="localStorage.removeItem('${V66_CONFIG_KEY}');location.reload()">Modifier la configuration Supabase</button></div>
    ` : `
      <div class="login-help">
        <b>Configuration Supabase commune</b><br>
        La configuration Supabase est automatiquement chargée et forcée depuis le fichier externe tbk-supabase-config.js à chaque ouverture de l’application.
        <label>URL Supabase<input id="supabaseUrl" type="text" value="${esc(cfg.url)}" placeholder="https://xxxx.supabase.co"></label>
        <label>Clé anon publique<input id="supabaseAnonKey" type="password" value="${esc(cfg.anonKey)}" placeholder="eyJ..."></label>
        <label>Email du compte technique Supabase<input id="supabaseDbEmail" type="email" value="${esc(cfg.dbEmail)}" placeholder="site-tbk@tbk.fr"></label>
        <label>Mot de passe du compte technique<input id="supabaseDbPassword" type="password" placeholder="Mot de passe Supabase"></label><div class="small" style="color:#c00000;font-weight:bold">Sécurité : le mot de passe n'est pas intégré dans le fichier HTML public. Il sera enregistré uniquement dans ce navigateur après validation.</div>
        <label>Saison<input id="supabaseSeason" type="text" value="${esc(cfg.seasonLabel)}"></label>
        <button class="secondary" type="button" onclick="saveV66Config()">Enregistrer la configuration Supabase</button>
      </div>
    `;
    el.innerHTML = `<div class="login-page"><div class="login-card">
      <div class="login-logo">🏸 TBK</div>
      <h1>Connexion au site club</h1>
      <p>Connecte-toi avec ton identifiant défini dans le site. La base Supabase est connectée avec un compte commun.</p>
      <label>Identifiant site<input id="loginUser" type="text" autocomplete="username" placeholder="admin, bureau, tournoi..." onkeydown="if(event.key==='Enter')document.getElementById('loginPassword').focus()"></label>
      <label>Mot de passe site<input id="loginPassword" type="password" autocomplete="current-password" placeholder="Mot de passe" onkeydown="if(event.key==='Enter')loginTBK()"></label>
      <button class="login-btn" ${configured?'':'disabled'} onclick="loginTBK()">Se connecter</button>
      <div id="loginMessage" class="login-error"></div>${configBlock}
    </div></div>`;
  };

  window.loginTBK = async function(){
    ensureAuthConfig();
    const msg = document.getElementById('loginMessage');
    const login = (document.getElementById('loginUser')?.value || '').trim().toLowerCase();
    const password = document.getElementById('loginPassword')?.value || '';
    const found = getAuthUsers().find(u => String(u.login).toLowerCase() === login && u.password === password && u.active !== false);
    if(!found){ if(msg) msg.textContent = 'Identifiant ou mot de passe site incorrect, ou utilisateur désactivé.'; return; }
    try{
      if(msg) msg.textContent = 'Connexion à la base Supabase...';
      await connectSharedDatabase();
      await loadSeason();
      await loadRemoteState();
      const prof = userProfile(found.role);
      sessionStorage.setItem(AUTH_STORAGE, JSON.stringify({ login:found.login, role:found.role, label:found.label || found.login, profileLabel:prof.label || found.role, connectedAt:Date.now(), dbMode:'shared_supabase' }));
      renderAll(true); renderLogin(); updateAuthChrome(); switchTab(defaultTabForUser());
    }catch(e){ console.error(e); if(msg) msg.textContent = 'Erreur Supabase : ' + (e.message || e); }
  };

  window.logoutTBK = async function(){
    sessionStorage.removeItem(AUTH_STORAGE);
    forceHideToolbarButtons(); renderLogin(); updateAuthChrome(); switchTab('login');
  };

  const oldUpdateAuthChrome = window.updateAuthChrome;
  window.updateAuthChrome = function(){
    if(typeof oldUpdateAuthChrome === 'function') oldUpdateAuthChrome();
    const status = document.getElementById('authStatus');
    const u = currentUser();
    if(status && u){
      const cfg = getV66Config();
      const saveTxt = v66LastSave ? ` - sauvegarde ${v66LastSave.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}` : '';
      status.innerHTML += `<span class="auth-pill"><small>DB commune ${esc(cfg.seasonLabel)}${saveTxt}</small></span>`;
    }
  };

  async function bootV66(){
    forceHideToolbarButtons(); renderLogin();
    const u = currentUser();
    if(!u){ updateAuthChrome(); switchTab('login'); return; }
    try{
      await connectSharedDatabase(); await loadSeason(); await loadRemoteState();
      renderAll(true); renderLogin(); updateAuthChrome(); enforceCurrentAccess();
    }catch(e){
      console.error(e); sessionStorage.removeItem(AUTH_STORAGE); renderLogin(); updateAuthChrome(); switchTab('login');
      const msg = document.getElementById('loginMessage'); if(msg) msg.textContent = 'Session site expirée ou Supabase indisponible : ' + (e.message || e);
    }
  }
  window.bootV66 = bootV66;
  setTimeout(bootV66, 60);
})();
