/* TBK V114 - Empêche la recreation automatique des matchs/scores après reset complet */
(function(){
  'use strict';

  const VERSION = 'V114';
  const DEFAULT_SEASON = '2026-2027';
  const DEFAULT_TOURNAMENT = 'Tournoi TBK 2026-2027';
  let cachedStatus = null;
  let cachedStatusAt = 0;

  function log(type, data){
    try { console.log('[TBK V114]', type, data || ''); } catch(e) {}
  }

  function cfg(){
    const c = window.TBK_SUPABASE_CONFIG || {};
    return {
      seasonLabel: c.seasonLabel || DEFAULT_SEASON,
      tournamentName: c.tournamentName || DEFAULT_TOURNAMENT
    };
  }

  function getClient(){
    const known = [window.tbkSupabaseClient, window.TBK_SUPABASE_CLIENT, window.supabaseClient, window.__tbkV112BSupabaseClient, window.__tbkV112SupabaseClient].filter(Boolean);
    for (const c of known) if (c && typeof c.rpc === 'function') return c;
    if (window.supabase && window.TBK_SUPABASE_CONFIG && window.TBK_SUPABASE_CONFIG.url && window.TBK_SUPABASE_CONFIG.anonKey) {
      window.__tbkV114SupabaseClient = window.__tbkV114SupabaseClient || window.supabase.createClient(window.TBK_SUPABASE_CONFIG.url, window.TBK_SUPABASE_CONFIG.anonKey);
      return window.__tbkV114SupabaseClient;
    }
    return null;
  }

  function currentActor(){
    return (window.currentUser && (window.currentUser.login || window.currentUser.email || window.currentUser.name)) || 'site';
  }

  async function matchGenerationStatus(force){
    if (!force && cachedStatus && Date.now() - cachedStatusAt < 2500) return cachedStatus;
    const sb = getClient();
    if (!sb) return { success:false, match_generation_locked:false, error:'Client Supabase indisponible' };
    const { data, error } = await sb.rpc('tbk_rpc_match_generation_status_v114');
    if (error) {
      return { success:false, match_generation_locked:false, error:error.message || String(error) };
    }
    cachedStatus = data || { success:true, match_generation_locked:false };
    cachedStatusAt = Date.now();
    updateBadge(cachedStatus);
    return cachedStatus;
  }

  function updateBadge(status){
    let el = document.getElementById('tbk-v114-match-lock-badge');
    if (!el) {
      el = document.createElement('button');
      el.id = 'tbk-v114-match-lock-badge';
      el.type = 'button';
      el.style.position = 'fixed';
      el.style.right = '14px';
      el.style.bottom = '118px';
      el.style.zIndex = '99999';
      el.style.borderRadius = '999px';
      el.style.padding = '7px 10px';
      el.style.fontSize = '12px';
      el.style.fontWeight = '700';
      el.style.boxShadow = '0 4px 14px rgba(0,0,0,.14)';
      el.onclick = async function(){
        const s = await matchGenerationStatus(true);
        alert('V114 Matchs/scores\nVerrou actif : ' + !!s.match_generation_locked + '\nMatchs : ' + (s.matches ?? '-') + '\nSets : ' + (s.sets ?? '-'));
      };
      document.body.appendChild(el);
    }
    const locked = !!(status && status.match_generation_locked);
    el.textContent = locked ? '🔒 Matchs bloqués' : '🔓 Matchs actifs';
    el.style.background = locked ? '#fff7ed' : '#ecfdf5';
    el.style.border = locked ? '1px solid #fed7aa' : '1px solid #bbf7d0';
    el.style.color = locked ? '#9a3412' : '#166534';
  }

  async function disableMatchGeneration(){
    const sb = getClient();
    if (!sb) throw new Error('Client Supabase indisponible');
    const { data, error } = await sb.rpc('tbk_rpc_disable_match_generation_v114', { p_actor: currentActor(), p_reason: 'admin site' });
    if (error) throw error;
    cachedStatus = null;
    await matchGenerationStatus(true);
    return data;
  }

  async function enableMatchGeneration(){
    const sb = getClient();
    if (!sb) throw new Error('Client Supabase indisponible');
    const ok = confirm('Déverrouiller la génération des matchs ?\n\nA utiliser uniquement lorsque tu veux générer le planning ou les matchs du tournoi.');
    if (!ok) return false;
    const { data, error } = await sb.rpc('tbk_rpc_enable_match_generation_v114', { p_actor: currentActor(), p_reason: 'deverrouillage administrateur depuis le site' });
    if (error) throw error;
    cachedStatus = null;
    await matchGenerationStatus(true);
    return data;
  }

  async function resetTournamentV114(){
    const sb = getClient();
    if (!sb) throw new Error('Client Supabase indisponible');
    if (!confirm('Reset complet tournoi : export SQL, suppression des matchs/scores, équipes, participants, émargements, puis recréation minimale. Continuer ?')) return false;
    const phrase = prompt('Pour confirmer, saisis exactement : RESET TOURNOI');
    if (phrase !== 'RESET TOURNOI') return false;
    window.TBK_BULK_RESET_IN_PROGRESS = true;
    window.TBK_REALTIME_PAUSED_UNTIL = Date.now() + 30000;
    window.TBK_SUPPRESS_AUTOSAVE_UNTIL = Date.now() + 30000;
    try { if (typeof window.stopRealtimeV94 === 'function') await window.stopRealtimeV94(); } catch(e) {}
    const c = cfg();
    const { data, error } = await sb.rpc('tbk_rpc_reset_tournament_complete_v114', {
      p_season_label: c.seasonLabel,
      p_tournament_name: c.tournamentName,
      p_actor: currentActor()
    });
    if (error) throw error;
    if (data && data.export_sql) {
      const blob = new Blob([data.export_sql], { type:'application/sql;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'TBK_EXPORT_TOURNOI_AVANT_RESET_' + new Date().toISOString().replace(/[:.]/g,'-') + '.sql';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    }
    cachedStatus = null;
    await matchGenerationStatus(true);
    try { if (typeof window.loadTournamentRelationalV91 === 'function') await window.loadTournamentRelationalV91(); } catch(e) {}
    try { if (typeof window.renderAll === 'function') window.renderAll(true); } catch(e) {}
    setTimeout(() => {
      window.TBK_BULK_RESET_IN_PROGRESS = false;
      try { if (typeof window.startRealtimeV94 === 'function') window.startRealtimeV94(); } catch(e) {}
    }, 6000);
    alert('Reset terminé. Les matchs et scores sont vides et verrouillés contre la recréation automatique.');
    return data;
  }

  function wrapScoreSaves(){
    const names = ['saveTournamentScoresRelationalV92', 'tbkV112BSaveScoreForLocalMatch'];
    names.forEach(name => {
      const old = window[name];
      if (typeof old !== 'function' || old.__tbkV114Wrapped) return;
      const wrapped = async function(){
        const status = await matchGenerationStatus(false);
        if (status.match_generation_locked) {
          log('score.save.blocked', { fn:name });
          return false;
        }
        return old.apply(this, arguments);
      };
      wrapped.__tbkV114Wrapped = true;
      window[name] = wrapped;
    });
  }

  function addUnlockButton(){
    if (document.getElementById('tbk-v114-unlock-matches-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'tbk-v114-unlock-matches-btn';
    btn.type = 'button';
    btn.textContent = '🔓 Activer matchs';
    btn.title = 'Déverrouiller la génération des matchs';
    btn.style.position = 'fixed';
    btn.style.right = '14px';
    btn.style.bottom = '154px';
    btn.style.zIndex = '99999';
    btn.style.borderRadius = '999px';
    btn.style.padding = '7px 10px';
    btn.style.fontSize = '12px';
    btn.style.fontWeight = '700';
    btn.style.background = '#eef2ff';
    btn.style.border = '1px solid #c7d2fe';
    btn.style.color = '#3730a3';
    btn.onclick = function(){ enableMatchGeneration().catch(e => alert('Erreur deverrouillage matchs : ' + (e.message || e))); };
    document.body.appendChild(btn);
  }

  function install(){
    wrapScoreSaves();
    addUnlockButton();
    matchGenerationStatus(true).catch(e => log('status.error', e.message || e));
    window.tbkV114MatchGenerationStatus = matchGenerationStatus;
    window.tbkV114DisableMatchGeneration = disableMatchGeneration;
    window.tbkV114EnableMatchGeneration = enableMatchGeneration;
    window.tbkV114ResetTournament = resetTournamentV114;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
  setTimeout(wrapScoreSaves, 2000);
  setInterval(() => matchGenerationStatus(false).catch(()=>{}), 10000);
})();
