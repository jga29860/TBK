(function(){
  'use strict';
  const VERSION = 'V113';
  const DEFAULT_SEASON = '2026-2027';
  const DEFAULT_TOURNAMENT = 'Tournoi TBK 2026-2027';

  function log(type, data){
    try { console.log('[TBK V113]', type, data || ''); } catch(e) {}
  }

  function isAdmin(){
    try {
      const candidates = [
        window.currentUserProfileCode,
        window.currentUserRole,
        window.currentRole,
        window.currentProfile,
        window.currentUser && window.currentUser.profile_code,
        window.currentUser && window.currentUser.role,
        window.TBK_CURRENT_USER && window.TBK_CURRENT_USER.profile_code,
        window.TBK_CURRENT_USER && window.TBK_CURRENT_USER.role
      ].filter(Boolean).map(v => String(v).toLowerCase());
      return candidates.includes('administrateur') || candidates.includes('admin');
    } catch(e) { return false; }
  }

  function cfg(){
    const c = window.TBK_SUPABASE_CONFIG || {};
    return {
      seasonLabel: c.seasonLabel || DEFAULT_SEASON,
      tournamentName: c.tournamentName || DEFAULT_TOURNAMENT
    };
  }

  function getClient(){
    if (window.tbkSupabaseClient) return window.tbkSupabaseClient;
    if (window.TBK_SUPABASE_CLIENT) return window.TBK_SUPABASE_CLIENT;
    if (window.supabaseClient) return window.supabaseClient;
    if (window.tkbSupabase) return window.tkbSupabase;
    if (window.supabase && window.TBK_SUPABASE_CONFIG && window.TBK_SUPABASE_CONFIG.url && window.TBK_SUPABASE_CONFIG.anonKey) {
      try {
        window.tbkSupabaseClient = window.supabase.createClient(window.TBK_SUPABASE_CONFIG.url, window.TBK_SUPABASE_CONFIG.anonKey);
        return window.tbkSupabaseClient;
      } catch(e) {}
    }
    return null;
  }

  function downloadText(filename, text){
    const blob = new Blob([text || ''], {type:'application/sql;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  function pauseRealtimeAndAutosave(){
    const until = Date.now() + 30000;
    window.TBK_BULK_RESET_IN_PROGRESS = true;
    window.TBK_SUPPRESS_AUTOSAVE_UNTIL = until;
    window.TBK_REALTIME_PAUSED_UNTIL = until;
    window.TBK_V103_SCORE_LOCAL_EDIT_UNTIL = until;
    try { if (typeof window.stopRealtimeV94 === 'function') window.stopRealtimeV94(); } catch(e) {}
  }

  function releaseRealtimeAndAutosave(){
    setTimeout(function(){
      window.TBK_BULK_RESET_IN_PROGRESS = false;
      window.TBK_SUPPRESS_AUTOSAVE_UNTIL = Date.now() + 1000;
      window.TBK_REALTIME_PAUSED_UNTIL = Date.now() + 1000;
      try { if (typeof window.startRealtimeV94 === 'function') window.startRealtimeV94(); } catch(e) {}
      try { if (typeof window.loadTournamentRelationalV91 === 'function') window.loadTournamentRelationalV91(); } catch(e) {}
      try { if (typeof window.loadTournamentScoresRelationalV92 === 'function') window.loadTournamentScoresRelationalV92(); } catch(e) {}
      try { if (typeof window.loadTournamentPlanningRelationalV93 === 'function') window.loadTournamentPlanningRelationalV93(); } catch(e) {}
      try { if (typeof window.renderAll === 'function') window.renderAll(true); } catch(e) {}
    }, 5000);
  }

  async function resetTournamentV113(){
    if (!isAdmin()) {
      alert('Action reservee au profil administrateur.');
      return;
    }
    const c = cfg();
    const msg = 'Cette action va :\n\n' +
      '1. Exporter toutes les donnees tournoi dans un fichier SQL\n' +
      '2. Supprimer toutes les donnees tournoi en base, y compris matchs et scores\n' +
      '3. Recreer une structure minimale propre sans aucun score\n\n' +
      'Continuer ?';
    if (!confirm(msg)) return;
    const typed = prompt('Pour confirmer, saisis exactement : RESET TOURNOI');
    if (typed !== 'RESET TOURNOI') {
      alert('Reinitialisation annulee.');
      return;
    }
    const sb = getClient();
    if (!sb) {
      alert('Client Supabase indisponible.');
      return;
    }
    pauseRealtimeAndAutosave();
    try {
      log('reset.start', c);
      const actor = (window.currentUser && (window.currentUser.login || window.currentUser.email)) || 'admin-site';
      const {data, error} = await sb.rpc('tbk_rpc_reset_tournament_complete_v113', {
        p_season_label: c.seasonLabel,
        p_tournament_name: c.tournamentName,
        p_actor: actor
      });
      if (error) throw error;
      const result = data || {};
      if (result.export_sql) {
        const stamp = new Date().toISOString().replace(/[:.]/g,'-');
        downloadText('TBK_EXPORT_TOURNOI_AVANT_RESET_' + stamp + '.sql', result.export_sql);
      }
      try {
        const keys = Object.keys(localStorage).filter(k => /tournament|tournoi|tbk.*state/i.test(k));
        keys.forEach(k => { if (!/config|supabase/i.test(k)) localStorage.removeItem(k); });
      } catch(e) {}
      alert('Tournoi reinitialise. Structure minimale recreee sans matchs ni scores.');
      log('reset.done', result);
    } catch(e) {
      console.error('[TBK V113] reset error', e);
      alert('Erreur Reset Tournoi : ' + (e.message || e));
    } finally {
      releaseRealtimeAndAutosave();
    }
  }

  function ensureButton(){
    if (!isAdmin()) return;
    if (document.getElementById('tbk-v113-reset-tournoi-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'tbk-v113-reset-tournoi-btn';
    btn.type = 'button';
    btn.textContent = '♻️ Réinit tournoi';
    btn.title = 'Exporter, supprimer puis reinitialiser completement le tournoi';
    btn.style.marginLeft = '8px';
    btn.style.background = '#fee2e2';
    btn.style.border = '1px solid #ef4444';
    btn.style.color = '#991b1b';
    btn.style.borderRadius = '10px';
    btn.style.padding = '7px 10px';
    btn.style.fontWeight = '700';
    btn.onclick = resetTournamentV113;

    const targets = [
      document.querySelector('#tournamentSubNav'),
      document.querySelector('.tournament-subnav'),
      document.querySelector('[data-page-key="emargement"]') && document.querySelector('[data-page-key="emargement"]').parentElement,
      document.querySelector('.toolbar'),
      document.querySelector('header'),
      document.body
    ].filter(Boolean);
    targets[0].appendChild(btn);
  }

  function patchOldReset(){
    window.tbkV113ResetTournament = resetTournamentV113;
    window.resetTournamentComplete = resetTournamentV113;
    window.tbkResetTournoiAdmin = resetTournamentV113;
  }

  document.addEventListener('DOMContentLoaded', function(){
    patchOldReset();
    setTimeout(ensureButton, 800);
    setInterval(ensureButton, 3000);
  });

  window.tbkV113Status = function(){
    return {
      version: VERSION,
      isAdmin: isAdmin(),
      buttonPresent: !!document.getElementById('tbk-v113-reset-tournoi-btn'),
      config: cfg(),
      bulkResetInProgress: !!window.TBK_BULK_RESET_IN_PROGRESS,
      realtimePausedUntil: window.TBK_REALTIME_PAUSED_UNTIL || null
    };
  };
})();
