/* TBK V85 - Regle de verrouillage inscriptions etendue
   Regle : si Cotisation Payee = Oui et Sante different de En attente,
   alors les champs suivants sont verrouilles pour tous les profils non administrateur :
   - Categorie
   - UFOLEP / FSGT
   - Sport
   - Montant cotisation
   - Cotisation payee
   - Sante
*/
(function(){
  const LOCK_TITLE = 'Dossier validé : modification réservée à l’administrateur';

  function norm(v){
    return String(v || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function isAdmin(){
    try { return typeof isAdminUser === 'function' && isAdminUser(); }
    catch(e){ return false; }
  }

  function isPaid(row){
    return norm(row && (row.cotisationPayee ?? row.cotisation_payee)) === 'oui';
  }

  function healthIsPending(row){
    const h = norm(row && row.sante);
    return !h || h === 'en attente' || h === 'attente' || h === 'a verifier' || h === 'a relancer';
  }

  function isRegistrationValidatedForLock(row){
    return isPaid(row) && !healthIsPending(row);
  }

  function fieldKey(field){
    return norm(field).replace(/[^a-z0-9]/g, '');
  }

  function isProtectedRegistrationField(field){
    const k = fieldKey(field);
    return k === 'categorie'
      || k === 'sport'
      || k === 'ufolep'
      || k === 'fsgt'
      || k === 'ufolepfsgt'
      || k === 'ufolepfsgtlicence'
      || k === 'licenceufolepfsgt'
      || k === 'montantcotisation'
      || k === 'montantcotisationcalculee'
      || k === 'montantcotisationcalcule'
      || k === 'cotisationpayee'
      || k === 'cotisationpaye'
      || k === 'cotisationpayeeoui'
      || k === 'sante';
  }

  function shouldLockField(row, field){
    return !isAdmin() && isProtectedRegistrationField(field) && isRegistrationValidatedForLock(row);
  }

  function disabledTitleAttr(row, field){
    return shouldLockField(row, field) ? 'disabled title="' + LOCK_TITLE + '"' : '';
  }

  function lockCss(row, field){
    return shouldLockField(row, field) ? ' locked-registration-field' : '';
  }

  function cellCss(row, field){
    return shouldLockField(row, field) ? ' class="locked-registration-cell"' : '';
  }

  function escLocal(s){
    if(typeof esc === 'function') return esc(s);
    return String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function ensureCustom(row){
    if(typeof ensureInscriptionCustomFields === 'function') return ensureInscriptionCustomFields(row);
    row.customFields = row.customFields || {};
    return row.customFields;
  }

  function selectOptions(col){
    if(col.type === 'yesno') return ['Oui', 'Non'];
    return Array.isArray(col.options) ? col.options : [];
  }

  function renderLockedAwareSelect(i, col, row, value, custom){
    const field = col.field || col.id;
    const dis = disabledTitleAttr(row, field);
    const options = selectOptions(col);
    if((value === undefined || value === null || String(value).trim() === '') && options.length === 1){
      value = options[0];
      if(custom) ensureCustom(row)[field] = value;
      else row[field] = value;
      try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch(e) {}
    }
    const opts = options.map(v => `<option ${value === v ? 'selected' : ''}>${escLocal(v)}</option>`).join('');
    const onchange = custom
      ? `updateCustomInscription(${i},'${field}',this.value)`
      : `updateInscription(${i},'${field}',this.value)`;
    return `<select class="${lockCss(row, field).trim()}" ${dis} onchange="${onchange}">${opts}</select>`;
  }

  function renderLockedAwareYesNo(i, col, row, value, custom){
    const field = col.field || col.id;
    const dis = disabledTitleAttr(row, field);
    const onchange = custom
      ? `updateCustomInscription(${i},'${field}',this.value)`
      : `updateInscription(${i},'${field}',this.value)`;
    return `<select class="${lockCss(row, field).trim()}" ${dis} onchange="${onchange}"><option ${value === 'Oui' ? 'selected' : ''}>Oui</option><option ${value !== 'Oui' ? 'selected' : ''}>Non</option></select>`;
  }

  function renderLockedAwareAmount(i, col, row, value, custom){
    const field = col.field || col.id;
    const locked = shouldLockField(row, field);
    const dis = disabledTitleAttr(row, field);
    const css = lockCss(row, field);

    if(custom){
      const onchange = `updateCustomInscription(${i},'${field}',this.value,true)`;
      return `<td${cellCss(row, field)}><input class="insc-input amount-input${css}" type="number" min="0" step="1" value="${escLocal(value || '')}" ${dis} onchange="${onchange}"></td>`;
    }

    const calc = (typeof cotisationCalculee === 'function') ? cotisationCalculee(row) : 0;
    const cot = (typeof montantCotisationEffectif === 'function') ? montantCotisationEffectif(row) : (value || '');
    const isManual = String(row.montantCotisation ?? '').trim() !== '';
    const euroCalc = (typeof euro === 'function') ? euro(calc) : (String(calc) + ' €');
    return `<td class="amount-calculated${locked ? ' locked-registration-cell' : ''}"><div class="amount-editor"><input class="insc-input amount-input${css}" type="number" min="0" step="1" value="${escLocal(cot)}" ${dis} title="Montant calculé proposé : ${escLocal(euroCalc)}. ${locked ? LOCK_TITLE : 'Ce montant reste modifiable.'}" onchange="updateInscriptionSoft(${i},'montantCotisation',this.value)"><button type="button" class="secondary mini-btn${css}" ${dis} title="Revenir au montant calculé ${escLocal(euroCalc)}" onclick="resetCotisationToCalculated(${i})">↻</button></div><div class="small amount-note">${isManual?'Modifié':'Calculé'} : ${escLocal(euroCalc)}</div></td>`;
  }

  function blockIfLocked(i, field){
    const arr = typeof ensureInscriptions === 'function' ? ensureInscriptions() : [];
    const row = arr[i];
    if(row && shouldLockField(row, field)){
      alert(LOCK_TITLE);
      if(typeof renderAll === 'function') renderAll(true);
      if(typeof switchTab === 'function') switchTab('inscriptions');
      return true;
    }
    return false;
  }

  const oldUpdateInscription = window.updateInscription;
  window.updateInscription = function(i, field, value){
    if(blockIfLocked(i, field)) return;
    return oldUpdateInscription.apply(this, arguments);
  };

  const oldUpdateInscriptionSoft = window.updateInscriptionSoft;
  window.updateInscriptionSoft = function(i, field, value){
    if(blockIfLocked(i, field)) return;
    return oldUpdateInscriptionSoft.apply(this, arguments);
  };

  const oldUpdateCustomInscription = window.updateCustomInscription;
  if(typeof oldUpdateCustomInscription === 'function'){
    window.updateCustomInscription = function(i, field, value, soft){
      if(blockIfLocked(i, field)) return;
      return oldUpdateCustomInscription.apply(this, arguments);
    };
  }

  const oldRenderInscriptionCell = window.renderInscriptionCell;
  window.renderInscriptionCell = function(i, col, row){
    const field = col.field || col.id;
    const custom = !col.builtIn;
    const value = custom ? (ensureCustom(row)[field] || '') : row[field];

    if(!isProtectedRegistrationField(field)){
      return oldRenderInscriptionCell.apply(this, arguments);
    }

    if(col.type === 'amount'){
      return renderLockedAwareAmount(i, col, row, value, custom);
    }
    if(col.type === 'yesno'){
      return `<td${cellCss(row, field)}>${renderLockedAwareYesNo(i, col, row, value, custom)}</td>`;
    }
    if(col.type === 'select'){
      return `<td${cellCss(row, field)}>${renderLockedAwareSelect(i, col, row, value, custom)}</td>`;
    }

    const dis = disabledTitleAttr(row, field);
    const inputType = col.type === 'email' ? 'email' : 'text';
    const css = col.css || '';
    const onchange = custom
      ? `updateCustomInscription(${i},'${field}',this.value,true)`
      : `updateInscriptionSoft(${i},'${field}',this.value)`;
    return `<td${cellCss(row, field)}><input class="insc-input ${css}${lockCss(row, field)}" type="${inputType}" value="${escLocal(value)}" ${dis} onchange="${onchange}"></td>`;
  };

  function injectCss(){
    if(document.getElementById('tbk-v85-registration-lock-style')) return;
    const style = document.createElement('style');
    style.id = 'tbk-v85-registration-lock-style';
    style.textContent = `
      .locked-registration-field,
      select.locked-registration-field,
      input.locked-registration-field,
      button.locked-registration-field {
        background:#eeeeee!important;
        color:#666666!important;
        cursor:not-allowed!important;
        border-color:#b7b7b7!important;
      }
      .locked-registration-cell {
        background:#f2f2f2!important;
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener('DOMContentLoaded', injectCss);
  setTimeout(injectCss, 300);

  window.tbkIsRegistrationValidatedForLockV85 = isRegistrationValidatedForLock;
  window.tbkShouldLockRegistrationFieldV85 = shouldLockField;
  window.tbkIsProtectedRegistrationFieldV85 = isProtectedRegistrationField;
})();
