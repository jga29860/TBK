/* TBK V80 - Correctif administration utilisateurs relationnelle
   - Nettoie le prefixe historique plain: dans les mots de passe
   - Charge utilisateurs/profils/droits depuis les tables relationnelles Supabase
   - Corrige login, ajout utilisateur, modification utilisateur, reset mot de passe
   - Ne modifie pas le CSS ni les autres modules metier
*/
(function(){
  const CFG_KEY = 'tbk_supabase_shared_config_v66';
  let clientCache = null;

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
    const supa = sb();
    if(!supa) throw new Error('Client Supabase non configuré.');
    if(!c.dbEmail || !c.dbPassword) throw new Error('Compte technique Supabase incomplet.');
    const session = await supa.auth.getSession();
    if(session && session.data && session.data.session && session.data.session.user && session.data.session.user.email === c.dbEmail){
      return session.data.session.user;
    }
    await supa.auth.signOut();
    const { data, error } = await supa.auth.signInWithPassword({ email: c.dbEmail, password: c.dbPassword });
    if(error) throw error;
    return data.user;
  }

  function normLogin(v){ return String(v || '').trim().toLowerCase(); }
  function cleanPassword(v){ return String(v || '').trim().replace(/^plain:/i, ''); }
  function escHtml(s){
    if(typeof esc === 'function') return esc(s);
    return String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
  }

  async function fetchUsers(){
    const supa = sb();
    await connectDb();
    const { data, error } = await supa
      .from('app_users')
      .select('id,login,display_name,email,password_hash,profile_code,active')
      .order('login', { ascending: true });
    if(error) throw error;
    return data || [];
  }

  async function fetchProfiles(){
    const supa = sb();
    await connectDb();
    const { data: profiles, error: pErr } = await supa
      .from('app_profiles')
      .select('profile_code,label,description,active')
      .eq('active', true)
      .order('profile_code', { ascending: true });
    if(pErr) throw pErr;

    const { data: pagePerms, error: pageErr } = await supa
      .from('profile_page_permissions')
      .select('profile_code,page_key,can_view,can_edit,can_admin');
    if(pageErr) throw pageErr;

    const { data: buttonPerms, error: btnErr } = await supa
      .from('profile_button_permissions')
      .select('profile_code,button_key,visible,enabled');
    if(btnErr) throw btnErr;

    const map = {};
    (profiles || []).forEach(p => {
      map[p.profile_code] = { label: p.label || p.profile_code, pages: [], toolbarButtons: [] };
    });
    (pagePerms || []).forEach(p => {
      if(p.can_view && map[p.profile_code]) map[p.profile_code].pages.push(p.page_key);
    });
    (buttonPerms || []).forEach(p => {
      if(p.visible && map[p.profile_code]) map[p.profile_code].toolbarButtons.push(p.button_key);
    });
    return map;
  }

  async function syncRelationalAuthToLocal(){
    const [users, profiles] = await Promise.all([fetchUsers(), fetchProfiles()]);
    const localUsers = users.map(u => ({
      id: u.id,
      login: normLogin(u.login),
      label: u.display_name || u.login,
      email: u.email || '',
      password: cleanPassword(u.password_hash),
      role: u.profile_code,
      active: u.active !== false
    }));
    if(typeof TBK_USERS_STORAGE !== 'undefined') localStorage.setItem(TBK_USERS_STORAGE, JSON.stringify(localUsers));
    if(typeof TBK_PROFILES_STORAGE !== 'undefined') localStorage.setItem(TBK_PROFILES_STORAGE, JSON.stringify(profiles));
    return { users: localUsers, profiles };
  }

  async function loadSingleUser(login){
    const supa = sb();
    await connectDb();
    const { data: user, error } = await supa
      .from('app_users')
      .select('id,login,display_name,email,password_hash,profile_code,active')
      .ilike('login', login)
      .maybeSingle();
    if(error) throw error;
    return user;
  }

  async function loadProfile(profileCode){
    const supa = sb();
    const { data: profile, error } = await supa
      .from('app_profiles')
      .select('profile_code,label,active')
      .eq('profile_code', profileCode)
      .maybeSingle();
    if(error) throw error;
    return profile;
  }

  function checkPassword(user, password){
    const expected = cleanPassword(user && user.password_hash);
    const provided = cleanPassword(password);
    if(!expected) throw new Error('Aucun mot de passe défini pour cet utilisateur.');
    if(expected !== provided) throw new Error('Mot de passe incorrect.');
    return true;
  }

  async function loginRelational(){
    const msg = document.getElementById('loginMessage');
    const login = normLogin(document.getElementById('loginUser')?.value || '');
    const password = document.getElementById('loginPassword')?.value || '';
    if(!login || !password){ if(msg) msg.textContent = 'Identifiant et mot de passe obligatoires.'; return; }
    try{
      if(msg) msg.textContent = 'Connexion à la base...';
      const user = await loadSingleUser(login);
      if(!user || user.active === false) throw new Error('Utilisateur introuvable ou désactivé.');
      checkPassword(user, password);
      const profile = await loadProfile(user.profile_code);
      if(!profile || profile.active === false) throw new Error('Profil utilisateur introuvable ou désactivé.');
      await syncRelationalAuthToLocal();
      const profileObj = typeof userProfile === 'function' ? userProfile(user.profile_code) : { label: profile.label || user.profile_code };
      sessionStorage.setItem(AUTH_STORAGE, JSON.stringify({
        login: user.login,
        role: user.profile_code,
        label: user.display_name || user.login,
        profileLabel: profileObj.label || profile.label || user.profile_code,
        connectedAt: Date.now(),
        dbMode: 'relational_users_v80'
      }));
      if(typeof renderAll === 'function') renderAll(true);
      if(typeof renderLogin === 'function') renderLogin();
      if(typeof updateAuthChrome === 'function') updateAuthChrome();
      if(typeof switchTab === 'function') switchTab(typeof defaultTabForUser === 'function' ? defaultTabForUser() : 'portal');
    }catch(e){
      console.error('[TBK V80] Erreur connexion relationnelle', e);
      if(msg) msg.textContent = 'Erreur lors de la connexion relationnelle : ' + (e.message || e);
    }
  }

  async function upsertUser(payload){
    const supa = sb();
    await connectDb();
    const clean = Object.assign({}, payload);
    if(clean.login) clean.login = normLogin(clean.login);
    if(clean.password_hash !== undefined) clean.password_hash = cleanPassword(clean.password_hash);
    clean.updated_at = new Date().toISOString();
    const { error } = await supa.from('app_users').upsert(clean, { onConflict: 'login' });
    if(error) throw error;
    await syncRelationalAuthToLocal();
  }

  window.loginTBK = loginRelational;
  window.syncRelationalAuthToLocalV80 = syncRelationalAuthToLocal;

  window.addAdminUser = async function(){
    const msg = document.getElementById('adminUserMsg');
    const login = normLogin(document.getElementById('newUserLogin')?.value || '');
    const label = String(document.getElementById('newUserLabel')?.value || '').trim();
    const password = cleanPassword(document.getElementById('newUserPassword')?.value || '');
    const role = document.getElementById('newUserRole')?.value || 'tournoi';
    if(!login || !password || !role){ if(msg) msg.textContent = 'Identifiant, mot de passe et profil sont obligatoires.'; return; }
    try{
      await upsertUser({
        login: login,
        display_name: label || login,
        email: login.includes('@') ? login : null,
        password_hash: password,
        profile_code: role,
        active: true
      });
      if(msg) msg.textContent = 'Utilisateur créé dans la base.';
      if(typeof renderUserAdmin === 'function') renderUserAdmin();
    }catch(e){
      console.error('[TBK V80] Erreur ajout utilisateur', e);
      if(msg) msg.textContent = 'Erreur création utilisateur : ' + (e.message || e);
      else alert('Erreur création utilisateur : ' + (e.message || e));
    }
  };

  window.updateAdminUser = async function(i, field, value){
    try{
      const users = await fetchUsers();
      const u = users[i];
      if(!u) return;
      const updates = { id: u.id, login: u.login };
      if(field === 'label') updates.display_name = value;
      else if(field === 'role') updates.profile_code = value;
      else if(field === 'active') updates.active = !!value;
      else updates[field] = value;
      await upsertUser(updates);
      if(typeof updateAuthChrome === 'function') updateAuthChrome();
      if(typeof renderUserAdmin === 'function') renderUserAdmin();
    }catch(e){
      alert('Erreur modification utilisateur : ' + (e.message || e));
    }
  };

  window.resetAdminPassword = async function(i){
    try{
      const input = document.getElementById('reset_' + i);
      const password = cleanPassword(input?.value || '');
      if(!password){ alert('Saisis un nouveau mot de passe.'); return; }
      const users = await fetchUsers();
      const u = users[i];
      if(!u) return;
      await upsertUser({ id: u.id, login: u.login, password_hash: password });
      alert('Mot de passe réinitialisé dans la base.');
      if(typeof renderUserAdmin === 'function') renderUserAdmin();
    }catch(e){
      alert('Erreur réinitialisation mot de passe : ' + (e.message || e));
    }
  };

  window.deleteAdminUser = async function(i){
    try{
      const users = await fetchUsers();
      const u = users[i];
      if(!u) return;
      if(normLogin(u.login) === 'admin'){ alert('Le compte admin est protégé.'); return; }
      if(!confirm('Supprimer cet utilisateur ?')) return;
      const supa = sb();
      await connectDb();
      const { error } = await supa.from('app_users').delete().eq('id', u.id);
      if(error) throw error;
      await syncRelationalAuthToLocal();
      if(typeof renderUserAdmin === 'function') renderUserAdmin();
    }catch(e){
      alert('Erreur suppression utilisateur : ' + (e.message || e));
    }
  };

  const originalRenderUserAdmin = window.renderUserAdmin;
  window.renderUserAdmin = function(){
    // On synchronise en arriere-plan puis on laisse le rendu existant utiliser le localStorage alimente depuis la base.
    syncRelationalAuthToLocal()
      .then(() => { if(typeof originalRenderUserAdmin === 'function') originalRenderUserAdmin(); })
      .catch(e => {
        console.error('[TBK V80] Erreur chargement admin users', e);
        if(typeof originalRenderUserAdmin === 'function') originalRenderUserAdmin();
      });
  };

  // Nettoie les mots de passe charges localement si besoin.
  setTimeout(function(){
    syncRelationalAuthToLocal().catch(e => console.warn('[TBK V80] sync auth initiale impossible', e));
  }, 700);
})();
