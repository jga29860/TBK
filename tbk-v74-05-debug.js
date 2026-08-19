/* TBK V74 - module externalise : tbk-v74-05-debug.js */
/* TBK V68 SUPABASE DEBUG SCRIPT */
(function(){
  const DBG_FLAG = 'tbk_supabase_debug_enabled_v68';
  const CFG_KEY = 'tbk_supabase_shared_config_v66';
  const LOG_KEY = 'tbk_supabase_debug_logs_v68';
  let dbgClient = null;
  function debugEnabled(){ return localStorage.getItem(DBG_FLAG) === '1'; }
  function setDebugEnabled(v){ localStorage.setItem(DBG_FLAG, v ? '1' : '0'); drawDebugUI(); }
  window.toggleSupabaseDebug = function(){ setDebugEnabled(!debugEnabled()); };
  function readConfig(){
    let local = {}; try { local = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch(e) { local = {}; }
    const globalCfg = window.TBK_SUPABASE_CONFIG || {};
    return { url: local.url || globalCfg.url || '', anonKey: local.anonKey || globalCfg.anonKey || '', dbEmail: local.dbEmail || globalCfg.dbEmail || '', dbPassword: local.dbPassword || globalCfg.dbPassword || '', seasonLabel: local.seasonLabel || globalCfg.seasonLabel || '2026-2027', source: local.url ? 'localStorage' : 'HTML' };
  }
  function mask(v, keep=6){ if(!v) return ''; const s=String(v); return s.length<=keep*2 ? '*'.repeat(s.length) : s.slice(0,keep)+'...'+s.slice(-keep); }
  function safeError(e){ return !e ? '' : (e.message || e.error_description || e.details || JSON.stringify(e)); }
  function writeLog(level, step, detail){
    const item={at:new Date().toISOString(),level,step,detail}; let arr=[]; try{arr=JSON.parse(localStorage.getItem(LOG_KEY)||'[]')}catch(e){arr=[]}
    arr.push(item); arr=arr.slice(-200); localStorage.setItem(LOG_KEY,JSON.stringify(arr));
    if(level==='error') console.error('[TBK Supabase]',step,detail); else console.log('[TBK Supabase]',step,detail);
    refreshDebugPanel();
  }
  window.tbkDebugLog = writeLog;
  function logsText(){let arr=[];try{arr=JSON.parse(localStorage.getItem(LOG_KEY)||'[]')}catch(e){arr=[]}return arr.length?arr.map(x=>`[${x.at}] ${x.level.toUpperCase()} - ${x.step}\n${typeof x.detail==='string'?x.detail:JSON.stringify(x.detail,null,2)}`).join('\n\n'):'Aucun log pour le moment.';}
  function getClient(){ if(dbgClient) return dbgClient; const cfg=readConfig(); if(!window.supabase||!cfg.url||!cfg.anonKey)return null; dbgClient=window.supabase.createClient(cfg.url,cfg.anonKey); return dbgClient; }
  async function runSupabaseDebugTest(){
    writeLog('info','test.start','Démarrage diagnostic Supabase'); const cfg=readConfig();
    writeLog('info','config',{supabaseJsLoaded:!!window.supabase,urlConfigured:!!cfg.url,anonKeyConfigured:!!cfg.anonKey,dbEmailConfigured:!!cfg.dbEmail,dbPasswordPresent:!!cfg.dbPassword,seasonLabel:cfg.seasonLabel,configSource:cfg.source,anonKeyMasked:mask(cfg.anonKey),dbEmail:cfg.dbEmail});
    const client=getClient(); if(!client){writeLog('error','client','Client Supabase impossible à créer.');return;}
    try{const s=await client.auth.getSession();writeLog('info','auth.getSession',{hasSession:!!s?.data?.session,email:s?.data?.session?.user?.email||null});}catch(e){writeLog('error','auth.getSession',safeError(e));}
    if(cfg.dbEmail&&cfg.dbPassword){try{const {data,error}=await client.auth.signInWithPassword({email:cfg.dbEmail,password:cfg.dbPassword});if(error)throw error;writeLog('ok','auth.signInWithPassword',{email:data?.user?.email,userId:data?.user?.id});}catch(e){writeLog('error','auth.signInWithPassword',safeError(e));}}else{writeLog('warn','auth.signInWithPassword','Email ou mot de passe technique absent.');}
    try{const {data,error}=await client.from('club_seasons').select('id,label,active').eq('label',cfg.seasonLabel).maybeSingle();if(error)throw error;writeLog(data?'ok':'warn','club_seasons.select',data||`Saison ${cfg.seasonLabel} introuvable`);}catch(e){writeLog('error','club_seasons.select',safeError(e));}
    try{const {count,error}=await client.from('app_state_snapshots').select('id',{count:'exact',head:true});if(error)throw error;writeLog('ok','app_state_snapshots.count',{count});}catch(e){writeLog('error','app_state_snapshots.count',safeError(e));}
    try{const {count,error}=await client.from('profiles').select('id',{count:'exact',head:true});if(error)throw error;writeLog('ok','profiles.count',{count});}catch(e){writeLog('error','profiles.count',safeError(e));}
    writeLog('info','test.end','Diagnostic terminé');
  }
  window.runSupabaseDebugTest=runSupabaseDebugTest;
  window.clearSupabaseDebugLogs=function(){localStorage.removeItem(LOG_KEY);refreshDebugPanel();};
  window.exportSupabaseDebugLogs=function(){const cfg=readConfig();const payload={exportedAt:new Date().toISOString(),config:{url:cfg.url,anonKey:mask(cfg.anonKey),dbEmail:cfg.dbEmail,dbPasswordPresent:!!cfg.dbPassword,seasonLabel:cfg.seasonLabel,source:cfg.source},logs:(()=>{try{return JSON.parse(localStorage.getItem(LOG_KEY)||'[]')}catch(e){return []}})()};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='tbk_supabase_debug.json';a.click();URL.revokeObjectURL(a.href);};
  function configSummaryHtml(){const cfg=readConfig();return `<pre>Supabase JS : ${window.supabase?'OK':'ABSENT'}\nURL : ${cfg.url||'non renseignée'}\nClé anon : ${cfg.anonKey?mask(cfg.anonKey):'non renseignée'}\nEmail technique : ${cfg.dbEmail||'non renseigné'}\nMot de passe technique : ${cfg.dbPassword?'présent dans ce navigateur':'absent'}\nSaison : ${cfg.seasonLabel}\nSource config : ${cfg.source}\nUtilisateur site : ${currentUser()?JSON.stringify(currentUser(),null,2):'non connecté'}</pre>`;}
  function refreshDebugPanel(){const body=document.getElementById('supabaseDebugBody');if(!body)return;body.innerHTML=`${configSummaryHtml()}<pre>${esc(logsText())}</pre>`;}
  function drawDebugUI(){document.querySelectorAll('.supabase-debug-panel,.supabase-debug-float-btn').forEach(e=>e.remove());if(!debugEnabled()){const btn=document.createElement('button');btn.type='button';btn.className='supabase-debug-float-btn no-print';btn.textContent='🐞 Debug Supabase';btn.onclick=()=>setDebugEnabled(true);document.body.appendChild(btn);return;}const panel=document.createElement('div');panel.className='supabase-debug-panel no-print';panel.innerHTML=`<h3>🐞 Debug Supabase V68</h3><div class="debug-row"><button onclick="runSupabaseDebugTest()">Lancer diagnostic</button><button onclick="exportSupabaseDebugLogs()">Exporter logs</button><button onclick="clearSupabaseDebugLogs()">Vider logs</button><button class="danger" onclick="toggleSupabaseDebug()">Fermer debug</button></div><div id="supabaseDebugBody"></div>`;document.body.appendChild(panel);refreshDebugPanel();}
  const previousRenderLogin=window.renderLogin; window.renderLogin=function(){if(typeof previousRenderLogin==='function')previousRenderLogin();const card=document.querySelector('#login .login-card');if(card&&!card.querySelector('.supabase-debug-card')){const box=document.createElement('div');box.className='supabase-debug-card';box.innerHTML=`<b>Mode debug Supabase</b><br><span class="small">Affiche la configuration masquée, teste la connexion, les droits RLS et la lecture des tables principales.</span><br><button type="button" class="secondary supabase-debug-toggle" onclick="toggleSupabaseDebug()">${debugEnabled()?'Désactiver':'Activer'} le debug Supabase</button><button type="button" class="secondary" onclick="runSupabaseDebugTest()">Test rapide</button>`;card.appendChild(box);}drawDebugUI();};
  const oldSaveRemoteV66=window.saveRemoteStateV66; if(typeof oldSaveRemoteV66==='function'){window.saveRemoteStateV66=async function(showMessage){writeLog('info','save.start','Début sauvegarde Supabase');try{const res=await oldSaveRemoteV66(showMessage);writeLog('ok','save.end',{success:res});return res;}catch(e){writeLog('error','save.error',safeError(e));throw e;}};}
  setTimeout(drawDebugUI,250);
})();
