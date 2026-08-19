/* TBK V81 - Correctif administration des profils relationnelle
   Diagnostic corrige : addAdminProfile ne mettait a jour que le localStorage.
   Cette version ecrit dans :
   - app_profiles
   - profile_page_permissions
   - profile_button_permissions
   et resynchronise ensuite le localStorage utilise par le rendu existant.
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
    if(session?.data?.session?.user?.email === c.dbEmail) return session.data.session.user;
    await supa.auth.signOut();
    const { data, error } = await supa.auth.signInWithPassword({ email:c.dbEmail, password:c.dbPassword });
    if(error) throw error;
    return data.user;
  }

  function normalizeProfileCode(v){
    return String(v || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  }

  function escHtml(s){
    if(typeof esc === 'function') return esc(s);
    return String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
  }

  async function syncAuthAfterProfileChange(){
    if(typeof syncRelationalAuthToLocalV80 === 'function'){
      await syncRelationalAuthToLocalV80();
    } else {
      // Fallback leger si le correctif V80 n'est pas present.
      const supa = sb();
      await connectDb();
      const { data: profiles, error: pErr } = await supa.from('app_profiles').select('profile_code,label,active').eq('active', true);
      if(pErr) throw pErr;
      const { data: pagePerms, error: pgErr } = await supa.from('profile_page_permissions').select('profile_code,page_key,can_view');
      if(pgErr) throw pgErr;
      const { data: buttonPerms, error: bErr } = await supa.from('profile_button_permissions').select('profile_code,button_key,visible');
      if(bErr) throw bErr;
      const map = {};
      (profiles || []).forEach(p => map[p.profile_code] = { label:p.label || p.profile_code, pages:[], toolbarButtons:[] });
      (pagePerms || []).forEach(p => { if(p.can_view && map[p.profile_code]) map[p.profile_code].pages.push(p.page_key); });
      (buttonPerms || []).forEach(p => { if(p.visible && map[p.profile_code]) map[p.profile_code].toolbarButtons.push(p.button_key); });
      if(typeof TBK_PROFILES_STORAGE !== 'undefined') localStorage.setItem(TBK_PROFILES_STORAGE, JSON.stringify(map));
    }
    if(typeof updateAuthChrome === 'function') updateAuthChrome();
  }

  async function getAllPages(){
    const supa = sb();
    const { data, error } = await supa.from('app_pages').select('page_key').eq('active', true);
    if(error) throw error;
    return (data || []).map(x => x.page_key);
  }

  async function getAllButtons(){
    const supa = sb();
    const { data, error } = await supa.from('app_buttons').select('button_key').eq('active', true);
    if(error) throw error;
    return (data || []).map(x => x.button_key);
  }

  async function createDefaultPermissionsForProfile(profileCode){
    const supa = sb();
    const pages = await getAllPages();
    const buttons = await getAllButtons();

    if(pages.length){
      const rows = pages.map(page_key => ({
        profile_code: profileCode,
        page_key,
        can_view: false,
        can_edit: false,
        can_admin: false
      }));
      const { error } = await supa.from('profile_page_permissions').upsert(rows, { onConflict:'profile_code,page_key' });
      if(error) throw error;
    }

    if(buttons.length){
      const rows = buttons.map(button_key => ({
        profile_code: profileCode,
        button_key,
        visible: false,
        enabled: false
      }));
      const { error } = await supa.from('profile_button_permissions').upsert(rows, { onConflict:'profile_code,button_key' });
      if(error) throw error;
    }
  }

  window.addAdminProfile = async function(){
    const msg = document.getElementById('adminUserMsg');
    const code = normalizeProfileCode(document.getElementById('newProfileId')?.value || '');
    const label = String(document.getElementById('newProfileLabel')?.value || '').trim();

    if(!code){ alert('Code profil obligatoire.'); return; }

    try{
      const supa = sb();
      await connectDb();

      const { data: existing, error: checkError } = await supa
        .from('app_profiles')
        .select('profile_code')
        .eq('profile_code', code)
        .maybeSingle();
      if(checkError) throw checkError;
      if(existing){ alert('Ce profil existe déjà.'); return; }

      const { error: insertError } = await supa.from('app_profiles').insert({
        profile_code: code,
        label: label || code,
        description: 'Profil créé depuis l’administration du site TBK',
        active: true
      });
      if(insertError) throw insertError;

      await createDefaultPermissionsForProfile(code);
      await syncAuthAfterProfileChange();

      if(document.getElementById('newProfileId')) document.getElementById('newProfileId').value = '';
      if(document.getElementById('newProfileLabel')) document.getElementById('newProfileLabel').value = '';
      if(msg) msg.textContent = 'Profil créé en base. Coche ensuite les pages et boutons autorisés.';
      if(typeof renderUserAdmin === 'function') renderUserAdmin();
    }catch(e){
      console.error('[TBK V81] Erreur création profil', e);
      alert('Erreur création profil : ' + (e.message || e));
    }
  };

  window.renameAdminProfile = async function(id, label){
    const code = normalizeProfileCode(id);
    if(!code) return;
    try{
      const supa = sb();
      await connectDb();
      const { error } = await supa
        .from('app_profiles')
        .update({ label: String(label || code).trim() || code, updated_at: new Date().toISOString() })
        .eq('profile_code', code);
      if(error) throw error;
      await syncAuthAfterProfileChange();
      if(typeof renderUserAdmin === 'function') renderUserAdmin();
    }catch(e){
      alert('Erreur renommage profil : ' + (e.message || e));
    }
  };

  window.toggleProfileRight = async function(id, page, checked){
    const code = normalizeProfileCode(id);
    try{
      const supa = sb();
      await connectDb();
      const payload = {
        profile_code: code,
        page_key: page,
        can_view: !!checked,
        can_edit: !!checked,
        can_admin: false,
        updated_at: new Date().toISOString()
      };
      if(code === 'administrateur'){
        payload.can_view = true;
        payload.can_edit = true;
        payload.can_admin = true;
      }
      const { error } = await supa.from('profile_page_permissions').upsert(payload, { onConflict:'profile_code,page_key' });
      if(error) throw error;
      await syncAuthAfterProfileChange();
    }catch(e){
      alert('Erreur droit page : ' + (e.message || e));
      if(typeof renderUserAdmin === 'function') renderUserAdmin();
    }
  };

  window.toggleProfileToolbarRight = async function(id, button, checked){
    const code = normalizeProfileCode(id);
    try{
      const supa = sb();
      await connectDb();
      const payload = {
        profile_code: code,
        button_key: button,
        visible: !!checked,
        enabled: !!checked,
        updated_at: new Date().toISOString()
      };
      if(code === 'administrateur'){
        payload.visible = true;
        payload.enabled = true;
      }
      const { error } = await supa.from('profile_button_permissions').upsert(payload, { onConflict:'profile_code,button_key' });
      if(error) throw error;
      await syncAuthAfterProfileChange();
      if(typeof updateToolbarRights === 'function') updateToolbarRights();
      if(typeof renderUserAdmin === 'function') renderUserAdmin();
    }catch(e){
      alert('Erreur droit bouton : ' + (e.message || e));
      if(typeof renderUserAdmin === 'function') renderUserAdmin();
    }
  };

  window.deleteAdminProfile = async function(id){
    const code = normalizeProfileCode(id);
    if(['administrateur','bureau','tournoi'].includes(code)){ alert('Profil système protégé.'); return; }
    if(!confirm('Supprimer ce profil ? Les utilisateurs associés seront réaffectés au profil tournoi.')) return;
    try{
      const supa = sb();
      await connectDb();
      // Reaffecte les utilisateurs avant suppression pour respecter les FK.
      const { error: updErr } = await supa
        .from('app_users')
        .update({ profile_code:'tournoi', updated_at:new Date().toISOString() })
        .eq('profile_code', code);
      if(updErr) throw updErr;

      const { error } = await supa.from('app_profiles').delete().eq('profile_code', code);
      if(error) throw error;
      await syncAuthAfterProfileChange();
      if(typeof renderUserAdmin === 'function') renderUserAdmin();
    }catch(e){
      alert('Erreur suppression profil : ' + (e.message || e));
    }
  };
})();
