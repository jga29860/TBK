/* TBK V108 - Garde-fou anti-tempete de requetes apres reset tournoi */
(function(){
  function paused(){
    return !!window.TBK_BULK_RESET_IN_PROGRESS || Date.now() < (window.TBK_REALTIME_PAUSED_UNTIL || 0);
  }

  function wrapStartRealtime(){
    if(window.__tbkV108StartRealtimeWrapped) return;
    const old = window.startRealtimeV94;
    if(typeof old !== 'function') return;
    window.__tbkV108StartRealtimeWrapped = true;
    window.startRealtimeV94 = async function(){
      if(paused()){
        try { console.log('[TBK V108] Realtime bloqué pendant reset/pause.'); } catch(e) {}
        return false;
      }
      return await old.apply(this, arguments);
    };
  }

  function wrapRenderAll(){
    if(window.__tbkV108RenderWrapped) return;
    const old = window.renderAll;
    if(typeof old !== 'function') return;
    window.__tbkV108RenderWrapped = true;
    window.renderAll = function(skipSave){
      if(window.TBK_SUPPRESS_RELATIONAL_AUTOSAVE || paused()){
        return old.call(this, true);
      }
      return old.apply(this, arguments);
    };
  }

  function wrapSaveTournament(){
    if(window.__tbkV108SaveTournamentWrapped) return;
    const old = window.saveTournamentRelationalV91;
    if(typeof old !== 'function') return;
    window.__tbkV108SaveTournamentWrapped = true;
    window.saveTournamentRelationalV91 = async function(showMessage){
      if(window.TBK_SUPPRESS_RELATIONAL_AUTOSAVE || window.TBK_BULK_RESET_IN_PROGRESS){
        try { console.log('[TBK V108] Sauvegarde tournoi ignorée pendant reset.'); } catch(e) {}
        return false;
      }
      return await old.apply(this, arguments);
    };
  }

  function install(){
    wrapStartRealtime();
    wrapRenderAll();
    wrapSaveTournament();
  }

  window.tbkV108ResetStormStatus = function(){
    return {
      bulkResetInProgress: !!window.TBK_BULK_RESET_IN_PROGRESS,
      suppressAutosave: !!window.TBK_SUPPRESS_RELATIONAL_AUTOSAVE,
      realtimePausedUntil: window.TBK_REALTIME_PAUSED_UNTIL || null,
      realtimePausedRemainingMs: Math.max(0, (window.TBK_REALTIME_PAUSED_UNTIL || 0) - Date.now())
    };
  };

  document.addEventListener('DOMContentLoaded', install);
  setTimeout(install, 1000);
  setTimeout(install, 3000);
})();
