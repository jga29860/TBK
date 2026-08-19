
/* ============================================================
   TBK V110 - Reset tournoi cote RPC uniquement
   - Le navigateur ne supprime plus directement les tables.
   - Le navigateur appelle une seule fonction RPC qui exporte,
     supprime, recree la structure minimale, audite et retourne
     le SQL d'export a telecharger.
   ============================================================ */
(function () {
  const V110 = {
    seasonLabel: '2026-2027',
    tournamentName: 'Tournoi TBK 2026-2027',
    pauseMs: 12000
  };

  function log(msg, data) {
    try { console.log('[TBK V110 Reset RPC]', msg, data || ''); } catch (_) {}
  }

  function getSupabaseClient() {
    return window.tbkSupabaseClient ||
      window.supabaseClient ||
      window.TBK_SUPABASE_CLIENT ||
      window.sb ||
      null;
  }

  function getCurrentUserRole() {
    const candidates = [
      window.currentUserProfileCode,
      window.currentUserProfile && window.currentUserProfile.profile_code,
      window.currentUserProfile && window.currentUserProfile.profil,
      window.currentUser && window.currentUser.profile_code,
      window.TBK_AUTH && window.TBK_AUTH.profileCode
    ];
    const found = candidates.find(Boolean);
    return String(found || '').toLowerCase();
  }

  function getCurrentLogin() {
    const candidates = [
      window.currentUserLogin,
      window.currentUser && window.currentUser.login,
      window.currentUser && window.currentUser.display_name,
      window.TBK_AUTH && window.TBK_AUTH.login
    ];
    return String(candidates.find(Boolean) || 'admin-site');
  }

  function isAdmin() {
    const role = getCurrentUserRole();
    if (role === 'administrateur' || role === 'admin') return true;
    try {
      if (typeof window.isCurrentUserAdmin === 'function') return !!window.isCurrentUserAdmin();
    } catch (_) {}
    return false;
  }

  function downloadTextFile(filename, content) {
    const blob = new Blob([content || ''], { type: 'text/sql;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { URL.revokeObjectURL(url); a.remove(); } catch (_) {}
    }, 500);
  }

  function setResetGuards(active) {
    const until = active ? Date.now() + V110.pauseMs : Date.now();
    window.TBK_BULK_RESET_IN_PROGRESS = !!active;
    window.TBK_SUPPRESS_AUTOSAVE_UNTIL = until;
    window.TBK_REALTIME_PAUSED_UNTIL = until;
    window.TBK_V109_BULK_OPERATION_UNTIL = until;
    window.TBK_V103_SCORE_LOCAL_EDIT_UNTIL = until;
  }

  async function stopRealtimeIfPossible() {
    try {
      if (typeof window.stopRealtimeV94 === 'function') await window.stopRealtimeV94();
    } catch (e) {
      log('stopRealtimeV94 warning', e.message || e);
    }
  }

  async function restartRealtimeLater() {
    setTimeout(async function () {
      try {
        window.TBK_BULK_RESET_IN_PROGRESS = false;
        if (typeof window.startRealtimeV94 === 'function') await window.startRealtimeV94();
        if (typeof window.tbkSetRealtimeBadge === 'function') window.tbkSetRealtimeBadge('ok', '🟢 Temps réel');
      } catch (e) {
        log('restart realtime warning', e.message || e);
        if (typeof window.tbkSetRealtimeBadge === 'function') window.tbkSetRealtimeBadge('error', '🔴 Temps réel KO');
      }
    }, V110.pauseMs + 1000);
  }

  async function reloadAfterReset() {
    try {
      if (typeof window.loadTournamentRelationalV91 === 'function') await window.loadTournamentRelationalV91();
      if (typeof window.loadTournamentScoresRelationalV92 === 'function') await window.loadTournamentScoresRelationalV92();
      if (typeof window.loadTournamentPlanningRelationalV93 === 'function') await window.loadTournamentPlanningRelationalV93();
    } catch (e) {
      log('reload relationnel warning', e.message || e);
    }
    try {
      if (typeof window.renderAll === 'function') window.renderAll(true);
    } catch (e) {
      log('renderAll warning', e.message || e);
    }
  }

  async function resetTournamentRpcOnly() {
    if (!isAdmin()) {
      alert('Action reservee au profil administrateur.');
      return;
    }

    const msg = 'Cette action va exporter les donnees tournoi, supprimer les donnees tournoi en base, puis recreer la configuration minimale. Continuer ?';
    if (!confirm(msg)) return;

    const confirmText = prompt('Pour confirmer, saisis exactement : RESET TOURNOI');
    if (confirmText !== 'RESET TOURNOI') {
      alert('Confirmation incorrecte. Operation annulee.');
      return;
    }

    const sb = getSupabaseClient();
    if (!sb || typeof sb.rpc !== 'function') {
      alert('Client Supabase indisponible.');
      return;
    }

    setResetGuards(true);
    await stopRealtimeIfPossible();
    if (typeof window.tbkSetRealtimeBadge === 'function') window.tbkSetRealtimeBadge('sync', '⏸ Reset tournoi...');

    try {
      const { data, error } = await sb.rpc('tbk_rpc_reset_tournament_full', {
        p_season_label: V110.seasonLabel,
        p_tournament_name: V110.tournamentName,
        p_confirm: 'RESET TOURNOI',
        p_site_login: getCurrentLogin()
      });

      if (error) throw error;

      const exportSql = data && data.export_sql ? data.export_sql : '-- Export vide ou non retourne par la fonction RPC.\n';
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      downloadTextFile(`TBK_EXPORT_TOURNOI_AVANT_RESET_V110_${ts}.sql`, exportSql);

      log('reset rpc ok', data);
      await reloadAfterReset();
      alert('Reset tournoi termine. Export SQL telecharge et structure minimale recreee.');
    } catch (e) {
      console.error(e);
      alert('Erreur reset tournoi RPC : ' + (e.message || e));
      if (typeof window.tbkSetRealtimeBadge === 'function') window.tbkSetRealtimeBadge('error', '🔴 Reset erreur');
    } finally {
      window.TBK_BULK_RESET_IN_PROGRESS = false;
      restartRealtimeLater();
    }
  }

  function ensureAdminResetButton() {
    if (!isAdmin()) return;
    let btn = document.getElementById('tbk-v110-reset-tournoi-btn');
    if (btn) return;

    btn = document.createElement('button');
    btn.id = 'tbk-v110-reset-tournoi-btn';
    btn.type = 'button';
    btn.textContent = '♻️ Réinit tournoi';
    btn.title = 'Exporter, supprimer et recreer le tournoi via RPC Supabase';
    btn.style.marginLeft = '8px';
    btn.style.background = '#7f1d1d';
    btn.style.color = '#fff';
    btn.style.border = '1px solid #991b1b';
    btn.style.borderRadius = '8px';
    btn.style.padding = '6px 10px';
    btn.style.fontWeight = '700';
    btn.addEventListener('click', resetTournamentRpcOnly);

    const targets = [
      document.querySelector('[data-page-key="emargement"]')?.parentElement,
      document.querySelector('#tournamentSubnav'),
      document.querySelector('.subnav'),
      document.querySelector('.toolbar'),
      document.querySelector('.topbar'),
      document.body
    ].filter(Boolean);

    targets[0].appendChild(btn);
  }

  function scheduleEnsure() {
    setTimeout(ensureAdminResetButton, 500);
    setTimeout(ensureAdminResetButton, 1500);
    setTimeout(ensureAdminResetButton, 3000);
  }

  document.addEventListener('DOMContentLoaded', scheduleEnsure);
  window.addEventListener('load', scheduleEnsure);
  document.addEventListener('click', function () { setTimeout(ensureAdminResetButton, 300); }, true);

  window.tbkV110ResetTournamentRpcOnly = resetTournamentRpcOnly;
  window.tbkV110EnsureResetButton = ensureAdminResetButton;
  window.tbkV110ResetStatus = function () {
    return {
      isAdmin: isAdmin(),
      role: getCurrentUserRole(),
      seasonLabel: V110.seasonLabel,
      tournamentName: V110.tournamentName,
      bulkResetInProgress: !!window.TBK_BULK_RESET_IN_PROGRESS,
      realtimePausedUntil: window.TBK_REALTIME_PAUSED_UNTIL || null,
      buttonPresent: !!document.getElementById('tbk-v110-reset-tournoi-btn')
    };
  };
})();
