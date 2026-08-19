/* TBK V83 - Administration relationnelle des colonnes inscriptions
   Objectif : l'administrateur gere les colonnes du suivi des inscriptions
   avec persistance en base Supabase dans public.registration_columns.
*/
(function(){
  const CFG_KEY = 'tbk_supabase_shared_config_v66';
  const STORAGE_KEY = typeof INSC_COLUMNS_STORAGE !== 'undefined' ? INSC_COLUMNS_STORAGE : 'tbk_inscription_columns_v50';
  const TABLE = 'registration_columns';
  let clientCache = null;
  let loadedForSeason = null;
  let loadingPromise = null;

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

  async function getSeason(){
    const supa = sb();
    const c = cfg();
    let { data, error } = await supa.from('club_seasons').select('id,label,active').eq('label', c.seasonLabel).maybeSingle();
    if(error) throw error;
    if(!data){
      const fallback = await supa.from('club_seasons').select('id,label,active').eq('active', true).limit(1).maybeSingle();
      if(fallback.error) throw fallback.error;
      data = fallback.data;
    }
    if(!data) throw new Error('Saison Supabase introuvable.');
    return data;
  }

  function escHtml(s){
    if(typeof esc === 'function') return esc(s);
    return String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
  }

  function splitColumnOptions(value){
    return String(value || '').split(',').map(x => x.trim()).filter(Boolean);
  }

  function defaultCols(){
    return typeof defaultInscriptionColumns === 'function' ? defaultInscriptionColumns() : [];
  }

  function sortCols(cols){
    return [...cols].sort((a,b) => (a.sort_order ?? a.sortOrder ?? 0) - (b.sort_order ?? b.sortOrder ?? 0));
  }

  function normalizeType(type){
    if(type === 'amount') return 'amount';
    if(type === 'yesno') return 'yesno';
    if(type === 'select') return 'select';
    if(type === 'date') return 'date';
    if(type === 'email') return 'email';
    if(type === 'number') return 'number';
    if(type === 'action') return 'action';
    return 'text';
  }

  function rowToCol(r){
    return {
      id: r.column_key,
      field: r.column_key,
      label: r.label || r.column_key,
      type: normalizeType(r.column_type),
      options: Array.isArray(r.options) ? r.options : [],
      visible: r.visible !== false,
      builtIn: r.built_in === true,
      sort_order: r.sort_order || 0,
      css: r.css_class || undefined,
      db_id: r.id
    };
  }

  function colToRow(col, seasonId, idx){
    return {
      season_id: seasonId,
      column_key: col.id || col.field,
      label: col.label || col.id || col.field,
      column_type: normalizeType(col.type),
      options: Array.isArray(col.options) ? col.options : [],
      visible: col.visible !== false,
      built_in: col.builtIn === true,
      sort_order: Number.isFinite(Number(col.sort_order)) ? Number(col.sort_order) : ((idx + 1) * 10),
      css_class: col.css || null,
      updated_at: new Date().toISOString()
    };
  }

  function setLocalColumns(cols){
    const normalized = sortCols(cols).map(c => ({...c, field:c.field || c.id}));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function localColumns(){
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if(Array.isArray(raw)) return raw;
    } catch(e) {}
    return defaultCols();
  }

  async function seedDefaultColumns(seasonId){
    const rows = defaultCols().map((c, i) => colToRow({...c, builtIn:true, sort_order:(i + 1) * 10}, seasonId, i));
    if(!rows.length) return [];
    const { data, error } = await sb().from(TABLE).upsert(rows, { onConflict:'season_id,column_key' }).select('*').order('sort_order', { ascending:true });
    if(error) throw error;
    return (data || []).map(rowToCol);
  }

  async function loadColumnsFromDb(force=false){
    const season = await getSeason();
    if(!force && loadedForSeason === season.id) return localColumns();
    const { data, error } = await sb().from(TABLE).select('*').eq('season_id', season.id).order('sort_order', { ascending:true });
    if(error) throw error;
    let cols = (data || []).map(rowToCol);
    if(!cols.length){
      cols = await seedDefaultColumns(season.id);
    }
    const defs = defaultCols();
    const ids = new Set(cols.map(c => c.id));
    const missingDefs = defs.filter(d => !ids.has(d.id));
    if(missingDefs.length){
      const start = cols.length;
      const rows = missingDefs.map((c, i) => colToRow({...c, builtIn:true, sort_order:(start + i + 1) * 10}, season.id, start + i));
      const up = await sb().from(TABLE).upsert(rows, { onConflict:'season_id,column_key' }).select('*').order('sort_order', { ascending:true });
      if(up.error) throw up.error;
      cols = (up.data || []).map(rowToCol);
    }
    loadedForSeason = season.id;
    setLocalColumns(cols);
    return cols;
  }

  async function ensureLoaded(){
    if(loadingPromise) return loadingPromise;
    loadingPromise = (async function(){
      try {
        await connectDb();
        return await loadColumnsFromDb(false);
      } finally {
        loadingPromise = null;
      }
    })();
    return loadingPromise;
  }

  async function upsertColumns(cols){
    await connectDb();
    const season = await getSeason();
    const sorted = cols.map((c, i) => ({...c, sort_order:(i + 1) * 10}));
    const rows = sorted.map((c, i) => colToRow(c, season.id, i));
    const { data, error } = await sb().from(TABLE).upsert(rows, { onConflict:'season_id,column_key' }).select('*').order('sort_order', { ascending:true });
    if(error) throw error;
    const saved = (data || []).map(rowToCol);
    setLocalColumns(saved);
    loadedForSeason = season.id;
    return saved;
  }

  function refreshInscriptions(){
    if(typeof renderAll === 'function') renderAll(true);
    if(typeof switchTab === 'function') switchTab('inscriptions');
  }

  // Override synchrone utilise par renderInscriptions.
  window.getInscriptionColumns = function(){
    const cols = localColumns();
    return sortCols(cols);
  };

  window.saveInscriptionColumns = function(cols){
    setLocalColumns(cols);
    upsertColumns(cols).catch(e => alert('Erreur sauvegarde colonnes : ' + (e.message || e)));
  };

  window.renderColumnAdminPanel = function(){
    if(typeof isAdminUser === 'function' && !isAdminUser()) return '';
    const cols = sortCols(localColumns());
    const rows = cols.map((c,i) => {
      const editableOptions = c.type === 'select';
      const optionsValue = escHtml((c.options || []).join(', '));
      return `<tr class="${c.visible===false?'column-hidden':''}">
        <td>${i+1}</td>
        <td><input value="${escHtml(c.label)}" onchange="renameInscriptionColumn('${escHtml(c.id)}',this.value)"></td>
        <td><span class="small">${escHtml(c.type)}</span></td>
        <td>${editableOptions?`<input class="column-options-input" value="${optionsValue}" placeholder="Valeur 1, Valeur 2" onchange="updateInscriptionColumnOptions('${escHtml(c.id)}',this.value)">`:'<span class="small muted">-</span>'}</td>
        <td><input type="checkbox" ${c.visible!==false?'checked':''} onchange="toggleInscriptionColumn('${escHtml(c.id)}',this.checked)"></td>
        <td><button class="secondary" onclick="moveInscriptionColumn('${escHtml(c.id)}',-1)">↑</button><button class="secondary" onclick="moveInscriptionColumn('${escHtml(c.id)}',1)">↓</button></td>
        <td>${c.builtIn?`<button class="secondary" onclick="toggleInscriptionColumn('${escHtml(c.id)}',false)">Masquer</button>`:`<button class="danger" onclick="deleteInscriptionColumn('${escHtml(c.id)}')">Supprimer</button>`}</td>
      </tr>`;
    }).join('');
    return `<div class="card wide column-admin-panel">
      <h3>Administration des colonnes</h3>
      <div class="small">Profil administrateur uniquement : renommer, masquer/supprimer, ajouter et déplacer les colonnes. Les changements sont enregistrés dans la table relationnelle <b>registration_columns</b>. Pour les colonnes de type <b>select</b>, les valeurs possibles sont séparées par des virgules.</div>
      <div class="admin-grid compact">
        <label>Nom nouvelle colonne<input id="newInscColLabel" placeholder="Ex : Remise spéciale"></label>
        <label>Type<select id="newInscColType" onchange="document.getElementById('newInscColOptionsWrap').style.display=this.value==='select'?'block':'none'"><option value="text">Texte</option><option value="yesno">Oui / Non</option><option value="select">Select</option><option value="date">Date</option><option value="number">Nombre</option><option value="email">Email</option></select></label>
        <label id="newInscColOptionsWrap" style="display:none">Valeurs possibles<input id="newInscColOptions" placeholder="Valeur 1, Valeur 2, Valeur 3"></label>
        <button onclick="addInscriptionColumn()">➕ Ajouter une colonne</button>
        <button class="secondary" onclick="reloadRegistrationColumnsFromDb()">↻ Recharger colonnes base</button>
        <button class="secondary" onclick="resetInscriptionColumns()">Réinitialiser colonnes</button>
      </div>
      <table class="excel column-admin-table"><tr><th>Ordre</th><th>Nom colonne</th><th>Type</th><th>Valeurs possibles si select</th><th>Visible</th><th>Déplacer</th><th>Action</th></tr>${rows}</table>
    </div>`;
  };

  window.renameInscriptionColumn = async function(id,label){
    const cols = localColumns();
    const c = cols.find(x => x.id === id);
    if(!c) return;
    c.label = String(label || c.label).trim() || c.label;
    setLocalColumns(cols);
    await upsertColumns(cols);
    refreshInscriptions();
  };

  window.toggleInscriptionColumn = async function(id,visible){
    const cols = localColumns();
    const c = cols.find(x => x.id === id);
    if(!c) return;
    c.visible = !!visible;
    setLocalColumns(cols);
    await upsertColumns(cols);
    refreshInscriptions();
  };

  window.updateInscriptionColumnOptions = async function(id,value){
    const cols = localColumns();
    const c = cols.find(x => x.id === id);
    if(!c) return;
    c.options = splitColumnOptions(value);
    setLocalColumns(cols);
    await upsertColumns(cols);
    refreshInscriptions();
  };

  window.moveInscriptionColumn = async function(id,dir){
    const cols = sortCols(localColumns());
    const i = cols.findIndex(x => x.id === id);
    const j = i + dir;
    if(i < 0 || j < 0 || j >= cols.length) return;
    [cols[i], cols[j]] = [cols[j], cols[i]];
    setLocalColumns(cols);
    await upsertColumns(cols);
    refreshInscriptions();
  };

  window.addInscriptionColumn = async function(){
    const label = String(document.getElementById('newInscColLabel')?.value || '').trim();
    const type = normalizeType(document.getElementById('newInscColType')?.value || 'text');
    const rawOptions = document.getElementById('newInscColOptions')?.value || '';
    if(!label){ alert('Nom de colonne obligatoire.'); return; }
    const id = 'custom_' + Date.now().toString(36);
    const col = { id, field:id, label, type, visible:true, builtIn:false, sort_order:900 };
    if(type === 'yesno') col.options = ['Oui','Non'];
    if(type === 'select'){
      const options = splitColumnOptions(rawOptions);
      if(!options.length){ alert('Pour une colonne de type select, indique au moins une valeur possible.'); return; }
      col.options = options;
    }
    const cols = sortCols(localColumns());
    const actionIndex = cols.findIndex(c => c.id === 'action');
    if(actionIndex >= 0) cols.splice(actionIndex, 0, col); else cols.push(col);
    setLocalColumns(cols);
    await upsertColumns(cols);
    refreshInscriptions();
  };

  window.deleteInscriptionColumn = async function(id){
    const cols = localColumns();
    const col = cols.find(c => c.id === id);
    if(!col || col.builtIn) return;
    if(!confirm('Supprimer cette colonne et les valeurs associées ?')) return;
    await connectDb();
    const season = await getSeason();
    const { error } = await sb().from(TABLE).delete().eq('season_id', season.id).eq('column_key', id);
    if(error) throw error;
    const next = cols.filter(c => c.id !== id);
    setLocalColumns(next);
    ensureInscriptions().forEach(x => { if(x.customFields) delete x.customFields[id]; });
    if(typeof syncRegistrationsRelationalV73 === 'function') syncRegistrationsRelationalV73(false);
    refreshInscriptions();
  };

  window.resetInscriptionColumns = async function(){
    if(!confirm('Réinitialiser les colonnes par défaut ? Les colonnes personnalisées seront retirées.')) return;
    await connectDb();
    const season = await getSeason();
    const { error } = await sb().from(TABLE).delete().eq('season_id', season.id);
    if(error) throw error;
    const cols = await seedDefaultColumns(season.id);
    setLocalColumns(cols);
    refreshInscriptions();
  };

  window.reloadRegistrationColumnsFromDb = async function(){
    try{
      await connectDb();
      await loadColumnsFromDb(true);
      refreshInscriptions();
    }catch(e){
      alert('Erreur rechargement colonnes : ' + (e.message || e));
    }
  };

  const oldRenderInscriptions = window.renderInscriptions;
  window.renderInscriptions = function(){
    if(typeof currentUser === 'function' && currentUser()){
      ensureLoaded().then(() => {
        // Si les colonnes viennent tout juste d'arriver, on rafraichit uniquement la page inscriptions.
        if(document.getElementById('inscriptions')?.classList.contains('active')){
          oldRenderInscriptions();
          if(typeof applySavedColumnWidths === 'function') applySavedColumnWidths();
        }
      }).catch(e => console.warn('[TBK V83] Chargement colonnes impossible', e));
    }
    return oldRenderInscriptions.apply(this, arguments);
  };

  setTimeout(function(){
    if(typeof currentUser === 'function' && currentUser()){
      ensureLoaded().then(() => {
        if(typeof renderAll === 'function') renderAll(true);
        if(typeof enforceCurrentAccess === 'function') enforceCurrentAccess();
      }).catch(e => console.warn('[TBK V83] Chargement initial colonnes impossible', e));
    }
  }, 1300);
})();
