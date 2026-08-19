/* TBK V87 - Correctif calcul cotisations encaissées / reste à percevoir
   Règle :
   - Cotisations théoriques = somme des montants de cotisation saisis.
   - Cotisations encaissées = somme des montants de cotisation saisis uniquement si Cotisation Payée = Oui.
   - Reste à percevoir = somme des montants de cotisation saisis uniquement si Cotisation Payée = Non ou différent de Oui.
*/
(function(){
  function admin(){
    try { return typeof isAdminUser === 'function' && isAdminUser(); }
    catch(e){ return false; }
  }

  function escLocal(s){
    if(typeof esc === 'function') return esc(s);
    return String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function normalize(v){
    return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function isCotisationPaid(row){
    return normalize(row && (row.cotisationPayee ?? row.cotisation_payee)) === 'oui';
  }

  function parseAmount(v){
    if(v === undefined || v === null) return 0;
    const raw = String(v).replace(',', '.').replace(/[^0-9.\-]/g, '').trim();
    if(raw === '' || raw === '-' || raw === '.') return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  function enteredCotisationAmount(row){
    return parseAmount(row && (row.montantCotisation ?? row.montant_cotisation));
  }

  function renderSettingInput(label, field, value, suffix){
    const locked = !admin();
    const dis = locked ? 'disabled title="Paramètre modifiable uniquement par l administrateur"' : '';
    return `<label>${label} <input class="settings-amount-input" type="number" min="0" step="1" value="${escLocal(value)}" ${dis} onchange="updateInscriptionSetting('${field}',this.value)"> ${suffix || '€'}</label>`;
  }

  function injectCss(){
    if(document.getElementById('tbk-v87-registration-cotisation-style')) return;
    const style = document.createElement('style');
    style.id = 'tbk-v87-registration-cotisation-style';
    style.textContent = `
      .cotisation-settings input.settings-amount-input {
        width:58px!important;
        min-width:58px!important;
        text-align:center!important;
      }
      .cotisation-settings input.settings-amount-input:disabled {
        background:#eeeeee!important;
        color:#666!important;
        cursor:not-allowed!important;
      }
      .inscriptions-table {
        font-size:11px!important;
        table-layout:auto!important;
      }
      .inscriptions-table th,
      .inscriptions-table td {
        padding:2px 3px!important;
        white-space:nowrap!important;
        vertical-align:middle!important;
      }
      .inscriptions-table input,
      .inscriptions-table select,
      .inscriptions-table textarea {
        text-align:center!important;
        min-height:24px!important;
        padding:3px 4px!important;
        font-size:11px!important;
      }
      .inscriptions-table .insc-input { width:108px!important; }
      .inscriptions-table .phone-input { width:105px!important; }
      .inscriptions-table .address-input { width:170px!important; text-align:left!important; }
      .inscriptions-table .mail-input { width:165px!important; text-align:left!important; }
      .inscriptions-table .date-input { width:98px!important; }
      .inscriptions-table .amount-input { width:68px!important; }
      .inscriptions-table .amount-editor { gap:2px!important; }
      .inscriptions-table .mini-btn,
      .inscriptions-table .mini-date-btn {
        padding:2px 5px!important;
        font-size:10px!important;
      }
      .inscriptions-table th { cursor:col-resize!important; }
      .inscriptions-table th:hover { box-shadow:inset 0 -2px 0 #fff2cc; }
      .inscriptions-table .amount-note { font-size:9px!important; text-align:center!important; }
    `;
    document.head.appendChild(style);
  }

  window.renderInscriptions = function(){
    const arr = ensureInscriptions();
    const set = ensureInscriptionSettings();
    const cols = visibleInscriptionColumns();

    arr.forEach(x => {
      x.categorie = x.categorie || 'Adulte';
      x.ufolep = x.ufolep || 'Non';
      x.whatsapp = x.whatsapp || 'Non';
      x.sport = x.sport || 'Bad';
      if(x.montantCotisation === undefined && x.montant_cotisation !== undefined) x.montantCotisation = x.montant_cotisation;
      if(x.montantCotisation === undefined) x.montantCotisation = '';
      x.cotisationPayee = x.cotisationPayee || x.cotisation_payee || 'Non';
      x.sante = x.sante || 'QS Sport';
      x.dateCertif = dateDisplay(x.dateCertif || '');
      x.telephone = x.telephone || '';
      x.adresse = x.adresse || '';
      x.mail = x.mail || '';
      x.dateNaissance = dateDisplay(x.dateNaissance || '');
      x.membreBureau = x.membreBureau || 'Non';
      ensureInscriptionCustomFields(x);
    });

    const total = arr.length;
    const adultes = arr.filter(x => x.categorie === 'Adulte').length;
    const jeunes = arr.filter(x => x.categorie === 'Jeune').length;
    const ufolep = arr.filter(x => x.ufolep === 'Oui').length;
    const payes = arr.filter(isCotisationPaid).length;
    const bureau = arr.filter(x => x.membreBureau === 'Oui').length;
    const bad = arr.filter(x => x.sport === 'Bad').length;
    const ping = arr.filter(x => x.sport === 'Ping').length;
    const badping = arr.filter(x => x.sport === 'Bad et Ping').length;

    const montantTotal = arr.reduce((sum, row) => sum + enteredCotisationAmount(row), 0);
    const encaisse = arr.reduce((sum, row) => sum + (isCotisationPaid(row) ? enteredCotisationAmount(row) : 0), 0);
    const reste = arr.reduce((sum, row) => sum + (!isCotisationPaid(row) ? enteredCotisationAmount(row) : 0), 0);

    const headers = cols.map(c => `<th>${escLocal(c.label)}</th>`).join('');
    const rows = arr.map((x,i) => `<tr class="${statusPaidClass(x)}">${cols.map(c => renderInscriptionCell(i,c,x)).join('')}</tr>`).join('');

    const settingsHtml = [
      renderSettingInput('Cotisation Adulte', 'cotisationAdulte', set.cotisationAdulte),
      renderSettingInput('Cotisation Jeune', 'cotisationJeune', set.cotisationJeune),
      renderSettingInput('Suppl. Bad + Ping', 'supplementBadPing', set.supplementBadPing),
      renderSettingInput('Suppl. UFOLEP', 'supplementUfolep', set.supplementUfolep),
      renderSettingInput('Réduction Bureau', 'reductionBureau', set.reductionBureau)
    ].join('');

    document.getElementById('inscriptions').innerHTML = `<div class="card module-nav"><button onclick="backHome()">← Retour à l'accueil</button><button onclick="switchTab('dashboard')">🏆 Gestion Tournoi</button></div><div class="card inscriptions-sticky-header"><h2>Suivi inscriptions TBK - Saison 2026-2027</h2><div class="cotisation-settings">${settingsHtml}</div><div class="row"><div class="kpi"><span>Total adhérents</span><br><strong>${total}</strong></div><div class="kpi"><span>Adultes / Jeunes</span><br><strong>${adultes}/${jeunes}</strong></div><div class="kpi"><span>UFOLEP</span><br><strong>${ufolep}</strong></div><div class="kpi"><span>Cotisations payées</span><br><strong>${payes}</strong></div><div class="kpi"><span>Cotisations théoriques</span><br><strong>${euro(montantTotal)}</strong></div><div class="kpi"><span>Cotisations encaissées</span><br><strong>${euro(encaisse)}</strong></div><div class="kpi"><span>Reste à percevoir</span><br><strong>${euro(reste)}</strong></div><div class="kpi"><span>Bureau</span><br><strong>${bureau}</strong></div><div class="kpi"><span>Bad/Ping/Mixte</span><br><strong>${bad}/${ping}/${badping}</strong></div><button onclick="addInscriptionDemo()">➕ Ajouter une inscription</button></div><div class="small" style="margin-top:8px">Cotisations théoriques = somme des montants saisis. Cotisations encaissées = somme des montants saisis avec Cotisation Payée = Oui. Reste à percevoir = somme des montants saisis avec Cotisation Payée différent de Oui.</div></div>${renderColumnAdminPanel()}<div class="card wide"><table class="excel inscriptions-table"><tr>${headers}</tr>${rows || `<tr><td colspan="${cols.length}" class="calc">Aucune inscription enregistrée. Clique sur Ajouter une inscription pour commencer.</td></tr>`}</table></div>`;

    injectCss();
  };

  document.addEventListener('click', function(e){
    const th = e.target && e.target.closest ? e.target.closest('#inscriptions table.inscriptions-table th') : null;
    if(!th) return;
    const table = th.closest('table.excel');
    if(!table || typeof autoFitColumn !== 'function') return;
    autoFitColumn(table, th.cellIndex, true);
  }, true);

  document.addEventListener('DOMContentLoaded', injectCss);
  setTimeout(injectCss, 300);
})();
