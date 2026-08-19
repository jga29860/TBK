/* TBK V95C - Correctif badge temps reel
   Probleme corrige : le badge pouvait disparaitre apres renderAll / changement de page,
   car il etait rattache a une zone du bandeau parfois remplacee par le rendu.
   Solution : rendre le badge persistant dans document.body, le restyler apres chaque rendu
   et relancer le realtime si necessaire apres authentification.
*/
(function(){
  const BADGE_ID = 'tbkRealtimeBadge';
  const STYLE_ID = 'tbkRealtimeBadgePersistentStyleV95C';
  let ensureTimer = null;

  function isConnected(){
    try { return typeof currentUser === 'function' && !!currentUser(); }
    catch(e){ return false; }
  }

  function status(){
    try { return typeof window.tbkRealtimeV94Status === 'function' ? window.tbkRealtimeV94Status() : null; }
    catch(e){ return null; }
  }

  function injectStyle(){
    if(document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #tbkRealtimeBadge.tbk-realtime-badge-fixed {
        position: fixed !important;
        top: 10px !important;
        right: 14px !important;
        z-index: 99998 !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        min-height: 26px !important;
        padding: 5px 10px !important;
        border-radius: 999px !important;
        border: 1px solid rgba(0,0,0,.08) !important;
        box-shadow: 0 4px 14px rgba(0,0,0,.14) !important;
        font-size: 12px !important;
        font-weight: 700 !important;
        line-height: 1 !important;
        pointer-events: auto !important;
        white-space: nowrap !important;
      }
      #tbkRealtimeBadge.tbk-realtime-ok {
        background: #dcfce7 !important;
        color: #166534 !important;
      }
      #tbkRealtimeBadge.tbk-realtime-warn {
        background: #fef3c7 !important;
        color: #92400e !important;
      }
      #tbkRealtimeBadge.tbk-realtime-error {
        background: #fee2e2 !important;
        color: #991b1b !important;
      }
      @media print {
        #tbkRealtimeBadge { display:none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function classifyText(text){
    const t = String(text || '').toLowerCase();
    if(t.includes('ko') || t.includes('erreur') || t.includes('inactif') || t.includes('pas de supabase')) return 'error';
    if(t.includes('sync') || t.includes('...') || t.includes('arrêt') || t.includes('arrete')) return 'warn';
    if(t.includes('temps réel') || t.includes('temps reel')) return 'ok';
    return 'warn';
  }

  function applyBadgeStyle(badge, cls){
    badge.classList.add('tbk-realtime-badge-fixed');
    badge.classList.remove('tbk-realtime-ok','tbk-realtime-warn','tbk-realtime-error');
    badge.classList.add('tbk-realtime-' + cls);
    badge.title = 'Synchronisation temps réel Supabase - badge persistant V95C';
  }

  function ensureBadge(defaultText){
    injectStyle();
    let badge = document.getElementById(BADGE_ID);
    if(!badge){
      badge = document.createElement('span');
      badge.id = BADGE_ID;
      document.body.appendChild(badge);
    }

    // Si le badge est dans une zone susceptible d'etre remplacee, on le deplace dans body.
    if(badge.parentNode !== document.body){
      document.body.appendChild(badge);
    }

    const st = status();
    if(!badge.textContent || defaultText){
      if(st && st.started) badge.textContent = '🟢 Temps réel';
      else if(isConnected()) badge.textContent = defaultText || '🟡 Temps réel...';
      else badge.textContent = '⚪ Temps réel en attente';
    }

    const cls = st && st.started ? 'ok' : classifyText(badge.textContent);
    applyBadgeStyle(badge, cls);
    return badge;
  }

  async function tryRestartRealtime(){
    if(!isConnected()) return;
    const st = status();
    if(st && st.started) return;
    if(typeof window.startRealtimeV94 !== 'function') return;
    try {
      ensureBadge('🟡 Temps réel...');
      await window.startRealtimeV94();
      const st2 = status();
      const badge = ensureBadge();
      if(st2 && st2.started){
        badge.textContent = '🟢 Temps réel';
        applyBadgeStyle(badge, 'ok');
      }
    } catch(e){
      const badge = ensureBadge();
      badge.textContent = '⚠ Temps réel inactif';
      applyBadgeStyle(badge, 'warn');
      try { console.warn('[TBK V95C] redemarrage realtime impossible', e); } catch(_e) {}
    }
  }

  function installRenderHooks(){
    if(window.__tbkV95CRealtimeBadgeHooked) return;
    window.__tbkV95CRealtimeBadgeHooked = true;

    const wrap = function(fnName){
      const old = window[fnName];
      if(typeof old !== 'function') return;
      window[fnName] = function(){
        const result = old.apply(this, arguments);
        setTimeout(function(){ ensureBadge(); }, 0);
        setTimeout(function(){ ensureBadge(); }, 250);
        return result;
      };
    };

    wrap('renderAll');
    wrap('updateAuthChrome');
    wrap('switchTab');
  }

  function startMonitor(){
    injectStyle();
    installRenderHooks();
    ensureBadge();

    if(ensureTimer) clearInterval(ensureTimer);
    ensureTimer = setInterval(function(){
      ensureBadge();
      tryRestartRealtime();
    }, 2500);

    try {
      const obs = new MutationObserver(function(){
        ensureBadge();
      });
      obs.observe(document.body, { childList:true, subtree:true });
    } catch(e) {}

    setTimeout(tryRestartRealtime, 1200);
    setTimeout(tryRestartRealtime, 4500);
    setTimeout(tryRestartRealtime, 8000);
  }

  window.ensureTbkRealtimeBadgeV95C = ensureBadge;

  document.addEventListener('DOMContentLoaded', startMonitor);
  setTimeout(startMonitor, 800);
})();
