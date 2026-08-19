
/*
  TBK V106 - Correctif Émargement : sauvegarde participant + anti-retour inscriptions
  A charger APRES tous les modules existants, notamment V91/V92/V93/V94/V105.
*/
(function(){
  'use strict';

  const V = 'V106-emargement-save-fix';
  const EDIT_GUARD_MS = 4500;
  let lastEmargementEditAt = 0;
  let userInitiatedNavigationAt = 0;
  let pendingSaveTimer = null;

  function log(type, details){
    try {
      if (window.tbkDebugLog) window.tbkDebugLog('emargement.v106.' + type, details || {});
      else console.debug('[TBK][V106][Emargement]', type, details || '');
    } catch(e) {}
  }

  function now(){ return Date.now(); }

  function normalizeText(v){ return String(v || '').trim().toLowerCase(); }

  function isVisible(el){
    if (!el) return false;
    const st = window.getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && el.offsetParent !== null;
  }

  function findEmargementRoot(){
    const candidates = [
      '#emargement', '#emargementPage', '#page-emargement', '#tab-emargement',
      '[data-page-key="emargement"]', '[data-tab="emargement"]', '.emargement',
      '[id*="emargement" i]', '[class*="emargement" i]'
    ];
    for (const sel of candidates){
      try {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) return el;
      } catch(e) {}
    }
    // fallback : section visible contenant un titre Emargement
    const visibleBlocks = Array.from(document.querySelectorAll('section,main,div'))
      .filter(isVisible)
      .filter(el => /émargement|emargement/i.test(el.textContent || ''));
    return visibleBlocks[0] || null;
  }

  function isInsideEmargement(target){
    if (!target || !target.closest) return false;
    const root = findEmargementRoot();
    if (root && root.contains(target)) return true;

    const row = target.closest('tr, .row, .team-row, .emargement-row');
    const txt = (row && row.textContent) || '';
    const name = (target.name || target.id || target.className || '').toString();
    return /dm-?\d|dh-?\d|présent|present|absent|cotisation/i.test(txt)
      && /joueur|player|participant|club|present|absent|paid|cotisation/i.test(name);
  }

  function markEmargementEdit(reason, target){
    lastEmargementEditAt = now();
    window.TBK_V106_EMARGEMENT_EDIT_UNTIL = lastEmargementEditAt + EDIT_GUARD_MS;
    window.TBK_LAST_ACTIVE_PAGE = 'emargement';
    window.TBK_ACTIVE_PAGE = 'emargement';
    log('edit', { reason, name: target && (target.name || target.id || target.className || target.tagName) });
  }

  function inEmargementGuard(){
    return now() < (window.TBK_V106_EMARGEMENT_EDIT_UNTIL || 0);
  }

  function queueEmargementSave(reason){
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = setTimeout(async function(){
      await safeSaveEmargement(reason || 'debounced');
    }, 350);
  }

  async function callIfExists(fnName, args){
    try {
      if (typeof window[fnName] === 'function') {
        log('call', { fn: fnName });
        const r = await window[fnName].apply(window, args || []);
        return r;
      }
    } catch(e) {
      log('call.error', { fn: fnName, error: e && e.message });
      throw e;
    }
    return undefined;
  }

  async function safeSaveEmargement(reason){
    window.TBK_V106_EMARGEMENT_SAVING = true;
    try {
      // Important : ne pas déclencher de navigation et ne pas appeler renderAll(false)
      // On tente les fonctions relationnelles existantes dans un ordre prudent.
      const candidates = [
        ['saveTournamentCheckinsRelationalV91', []],
        ['saveTournamentRelationalV91', [true]],
        ['saveTournamentRelational', [true]],
        ['tbkSaveTournamentRelational', [true]],
        ['saveTournamentStateRelational', [true]]
      ];

      let called = false;
      for (const [fn, args] of candidates){
        if (typeof window[fn] === 'function') {
          called = true;
          await callIfExists(fn, args);
          break;
        }
      }

      // Fallback : sauvegarde globale uniquement si aucune fonction dédiée n'existe.
      if (!called && typeof window.save === 'function') {
        log('fallback.save', { reason });
        await window.save();
      }

      if (typeof window.tbkSetRealtimeBadge === 'function') {
        window.tbkSetRealtimeBadge('ok', '🟢 Emargement sauvegardé');
      }
      log('save.done', { reason, called });
    } catch(e) {
      console.error('[TBK V106] Erreur sauvegarde émargement', e);
      if (typeof window.tbkSetRealtimeBadge === 'function') {
        window.tbkSetRealtimeBadge('error', '⚠ Sauvegarde émargement KO');
      }
      log('save.error', { reason, error: e && e.message });
    } finally {
      window.TBK_V106_EMARGEMENT_SAVING = false;
    }
  }

  function protectAgainstUnexpectedInscriptionsNavigation(){
    const guardTargetPages = ['inscriptions', 'registration', 'registrations'];

    function shouldBlock(pageKey){
      const p = normalizeText(pageKey);
      if (!guardTargetPages.some(k => p.includes(k))) return false;
      if (!inEmargementGuard()) return false;
      // Autoriser si clic utilisateur récent sur un vrai bouton de navigation inscriptions.
      if (now() - userInitiatedNavigationAt < 800) return false;
      return true;
    }

    function wrap(name, pageArgIndex){
      const old = window[name];
      if (typeof old !== 'function' || old.__tbkV106Wrapped) return;
      const wrapped = function(){
        const arg = arguments[pageArgIndex || 0];
        const page = arg || name;
        if (shouldBlock(page)) {
          log('nav.blocked', { fn: name, page: page });
          restoreEmargementViewSoon();
          return false;
        }
        return old.apply(this, arguments);
      };
      wrapped.__tbkV106Wrapped = true;
      window[name] = wrapped;
    }

    [
      ['openInscriptionsHome', 0], ['openRegistrationHome', 0], ['openRegistrationsHome', 0],
      ['showInscriptions', 0], ['showRegistrations', 0], ['switchTab', 0], ['showPage', 0],
      ['openPage', 0], ['navigateTo', 0]
    ].forEach(x => wrap(x[0], x[1]));
  }

  function restoreEmargementViewSoon(){
    setTimeout(function(){
      if (!inEmargementGuard()) return;
      try {
        if (typeof window.switchTab === 'function') window.switchTab('emargement');
        else if (typeof window.showPage === 'function') window.showPage('emargement');
        else if (typeof window.openTournamentHome === 'function') window.openTournamentHome();
      } catch(e) {}
    }, 50);
  }

  function installListeners(){
    // Mémoriser les clics volontaires sur navigation inscriptions
    document.addEventListener('click', function(e){
      const btn = e.target && e.target.closest && e.target.closest('button,a,[role="button"]');
      if (!btn) return;
      const txt = normalizeText(btn.textContent || btn.getAttribute('aria-label') || btn.getAttribute('title') || '');
      if (txt.includes('inscription')) userInitiatedNavigationAt = now();
    }, true);

    // Sauvegarde immédiate quand on modifie l'émargement
    ['input','change','blur'].forEach(ev => {
      document.addEventListener(ev, function(e){
        const t = e.target;
        if (!isInsideEmargement(t)) return;
        markEmargementEdit(ev, t);
        if (ev === 'change' || ev === 'blur' || /checkbox|radio|select-one/.test((t.type || '').toLowerCase())) {
          queueEmargementSave(ev);
        } else {
          queueEmargementSave('input');
        }
      }, true);
    });
  }

  function patchRenderAll(){
    const old = window.renderAll;
    if (typeof old !== 'function' || old.__tbkV106Wrapped) return;
    const wrapped = function(){
      const wasGuard = inEmargementGuard();
      const r = old.apply(this, arguments);
      if (wasGuard) restoreEmargementViewSoon();
      return r;
    };
    wrapped.__tbkV106Wrapped = true;
    window.renderAll = wrapped;
  }

  function init(){
    protectAgainstUnexpectedInscriptionsNavigation();
    installListeners();
    patchRenderAll();
    log('init', { version: V });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Export diagnostic
  window.tbkV106EmargementDiagnostic = function(){
    return {
      version: V,
      inGuard: inEmargementGuard(),
      editUntil: window.TBK_V106_EMARGEMENT_EDIT_UNTIL || null,
      saving: !!window.TBK_V106_EMARGEMENT_SAVING,
      rootFound: !!findEmargementRoot(),
      activePage: window.TBK_ACTIVE_PAGE || null,
      lastActivePage: window.TBK_LAST_ACTIVE_PAGE || null,
      saveFns: [
        'saveTournamentCheckinsRelationalV91',
        'saveTournamentRelationalV91',
        'saveTournamentRelational',
        'tbkSaveTournamentRelational',
        'saveTournamentStateRelational'
      ].filter(fn => typeof window[fn] === 'function')
    };
  };
})();
