/* TBK V82 - Masquage strict des boutons d'accès aux pages non autorisées
   Objectif : un utilisateur ne voit aucun bouton/carte/menu menant vers une page sans droit can_view.
   S'appuie sur canAccessTab(tabId) et allowedTabsForUser() alimentés par les droits relationnels Supabase.
*/
(function(){
  function isAllowed(pageKey){
    try {
      return typeof canAccessTab === 'function' && canAccessTab(pageKey);
    } catch(e) {
      return false;
    }
  }

  function setVisible(el, visible){
    if(!el) return;
    el.hidden = !visible;
    el.style.display = visible ? '' : 'none';
    el.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function hidePageAccessButtons(){
    const userConnected = typeof currentUser === 'function' && !!currentUser();

    // Navigation principale : boutons avec data-tab.
    document.querySelectorAll('[data-tab]').forEach(btn => {
      const pageKey = btn.getAttribute('data-tab');
      setVisible(btn, userConnected && isAllowed(pageKey));
    });

    // Si non connecté, on laisse uniquement la page login active et on masque les accès applicatifs.
    if(!userConnected){
      document.querySelectorAll('.portal-card,.tournament-nav-btn,.module-nav button').forEach(el => setVisible(el, false));
      return;
    }

    // Cartes de la page accueil.
    document.querySelectorAll('.portal-card').forEach(card => {
      const action = card.getAttribute('onclick') || '';
      let target = null;
      if(action.includes('openInscriptionsHome')) target = 'inscriptions';
      else if(action.includes('openTournamentHome')) target = 'dashboard';
      else if(action.includes("switchTab('documentation')") || action.includes('switchTab("documentation")')) target = 'documentation';
      else if(action.includes("switchTab('adminUsers')") || action.includes('switchTab("adminUsers")')) target = 'adminUsers';
      setVisible(card, !target || isAllowed(target));
    });

    // Sous-menu tournoi : boutons générés sans data-tab, on se base sur leur onclick.
    document.querySelectorAll('.tournament-nav-btn').forEach(btn => {
      const action = btn.getAttribute('onclick') || '';
      let target = null;
      const m1 = action.match(/switchTab\('([^']+)'\)/);
      const m2 = action.match(/switchTab\("([^"]+)"\)/);
      if(m1) target = m1[1];
      else if(m2) target = m2[1];
      else if(action.includes('backHome')) target = (typeof defaultTabForUser === 'function') ? defaultTabForUser() : 'portal';
      setVisible(btn, !target || isAllowed(target));
    });

    // Boutons de navigation module, par exemple retour accueil / gestion tournoi.
    document.querySelectorAll('.module-nav button').forEach(btn => {
      const action = btn.getAttribute('onclick') || '';
      let target = null;
      const m1 = action.match(/switchTab\('([^']+)'\)/);
      const m2 = action.match(/switchTab\("([^"]+)"\)/);
      if(m1) target = m1[1];
      else if(m2) target = m2[1];
      else if(action.includes('backHome')) target = (typeof defaultTabForUser === 'function') ? defaultTabForUser() : 'portal';
      setVisible(btn, !target || isAllowed(target));
    });
  }

  // Securise aussi les fonctions d'ouverture depuis les cartes d'accueil.
  window.openInscriptionsHome = function(){
    if(isAllowed('inscriptions')) switchTab('inscriptions');
  };
  window.openTournamentHome = function(){
    if(isAllowed('dashboard')) switchTab('dashboard');
  };
  window.backHome = function(){
    const target = (typeof defaultTabForUser === 'function') ? defaultTabForUser() : 'portal';
    if(isAllowed(target)) switchTab(target);
  };

  // Patch des fonctions de rendu pour reappliquer le masquage apres chaque regeneration HTML.
  const oldUpdateAuthChrome = window.updateAuthChrome;
  window.updateAuthChrome = function(){
    if(typeof oldUpdateAuthChrome === 'function') oldUpdateAuthChrome.apply(this, arguments);
    hidePageAccessButtons();
  };

  const oldRenderAll = window.renderAll;
  window.renderAll = function(){
    const result = oldRenderAll.apply(this, arguments);
    setTimeout(hidePageAccessButtons, 0);
    return result;
  };

  const oldRenderPortal = window.renderPortal;
  window.renderPortal = function(){
    const result = oldRenderPortal.apply(this, arguments);
    setTimeout(hidePageAccessButtons, 0);
    return result;
  };

  const oldRenderDashboard = window.renderDashboard;
  window.renderDashboard = function(){
    const result = oldRenderDashboard.apply(this, arguments);
    setTimeout(hidePageAccessButtons, 0);
    return result;
  };

  const oldRenderUserAdmin = window.renderUserAdmin;
  window.renderUserAdmin = function(){
    const result = oldRenderUserAdmin.apply(this, arguments);
    setTimeout(hidePageAccessButtons, 0);
    return result;
  };

  const oldSwitchTab = window.switchTab;
  window.switchTab = function(tabId){
    if(tabId !== 'login' && !isAllowed(tabId)){
      const target = (typeof defaultTabForUser === 'function') ? defaultTabForUser() : 'login';
      return oldSwitchTab.call(this, target);
    }
    const result = oldSwitchTab.apply(this, arguments);
    setTimeout(hidePageAccessButtons, 0);
    return result;
  };

  document.addEventListener('DOMContentLoaded', () => setTimeout(hidePageAccessButtons, 0));
  window.addEventListener('pageshow', () => setTimeout(hidePageAccessButtons, 0));
  window.addEventListener('focus', () => setTimeout(hidePageAccessButtons, 0));
  setTimeout(hidePageAccessButtons, 1200);
})();
