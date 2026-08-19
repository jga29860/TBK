/* TBK V103 - Stabilisation saisie scores + anti-boucle Supabase
   - Evite que la saisie d'un score declenche une cascade renderAll(false) -> saves multiples.
   - Sauvegarde uniquement le module scores, avec debounce et garde-fou anti-refresh realtime local.
   - Deplace automatiquement le curseur vers la zone de score suivante apres saisie.
*/
(function(){
  const SAVE_DELAY_MS = 1200;
  const LOCAL_GUARD_MS = 7000;
  let scoreSaveTimer = null;
  let inputTimers = {};
  let lastQueuedHash = '';
  let lastSavedHash = '';
  let nextFocusInfo = null;

  function log(step, detail){
    try { console.log('[TBK V103]', step, detail || ''); } catch(e) {}
    try { if(typeof tbkDebugLog === 'function') tbkDebugLog('info', 'scores.v103.' + step, detail || ''); } catch(e) {}
  }

  function allMatches(){
    const out = [];
    try{
      ['dm','dh'].forEach(key => (getAllMatches(key) || []).forEach(m => out.push(m)));
    }catch(e){}
    return out;
  }

  function scoreHash(){
    try{
      return JSON.stringify(allMatches().map(m => ({
        c:m.comp,
        id:m.id,
        s:m.scores,
        d:!!m.done,
        w:m.winner || null,
        l:m.loser || null,
        st:m.startedAt || null,
        en:m.endedAt || null
      })));
    }catch(e){ return String(Date.now()); }
  }

  function markLocalScoreEdit(ms){
    window.TBK_V103_SCORE_LOCAL_EDIT_UNTIL = Date.now() + (ms || LOCAL_GUARD_MS);
  }

  function parseScoreValue(val){
    if(val === '' || val === null || val === undefined) return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }

  function scoreValueAtSafe(m,setIdx,side){
    const v = m && m.scores && m.scores[setIdx] ? m.scores[setIdx][side] : null;
    return Number.isFinite(v) ? v : null;
  }

  function findMatch(key,id){
    try { return (getAllMatches(key) || []).find(x => Number(x.id) === Number(id)); }
    catch(e){ return null; }
  }

  function setScoreLocalOnly(key,id,setIdx,side,val){
    const m = findMatch(key,id);
    if(!m){ alert('Match introuvable pour la saisie du score.'); return false; }

    if(typeof isKOLockedByPools === 'function' && isKOLockedByPools(m)){
      alert(typeof poolLockReason === 'function' ? poolLockReason(m) : 'Match verrouillé.');
      if(typeof renderAll === 'function') renderAll(true);
      return false;
    }

    if(typeof matchHasAbsent === 'function' && matchHasAbsent(m)){
      alert('Score impossible : au moins un participant de ce match est marqué absent dans l émargement.');
      if(typeof renderAll === 'function') renderAll(true);
      return false;
    }

    const newVal = parseScoreValue(val);
    const oldVal = scoreValueAtSafe(m,setIdx,side);
    if(oldVal === newVal) return true;

    const wasDone = !!m.done;
    if(wasDone){
      const ok = confirm(`Ce match est déjà terminé (${String(m.comp).toUpperCase()} ${m.id}).\n\nConfirmer la modification des scores ?`);
      if(!ok){ if(typeof renderAll === 'function') renderAll(true); return false; }
    }

    m.scores = m.scores || [[null,null],[null,null],[null,null]];
    m.scores[setIdx] = m.scores[setIdx] || [null,null];
    m.scores[setIdx][side] = newVal;

    try { m.done = (typeof isMatchComplete === 'function') ? isMatchComplete(m) : false; } catch(e){ m.done = false; }
    try { if(typeof computeMatchWinner === 'function') computeMatchWinner(m); } catch(e) {}

    if(m.done && !wasDone){
      if(!m.startedAt && Number.isFinite(m.court)) m.startedAt = Date.now();
      if(m.startedAt && !m.endedAt) m.endedAt = Date.now();
    }
    if(!m.done) delete m.endedAt;

    markLocalScoreEdit();
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch(e) {}

    // Tres important : renderAll(true) evite la sauvegarde relationnelle globale V91.
    if(typeof renderAll === 'function') renderAll(true);
    return true;
  }

  function focusNextScoreField(){
    if(!nextFocusInfo) return;
    const inputs = Array.from(document.querySelectorAll('input.tbk-score-v103'));
    if(!inputs.length) return;
    const idx = inputs.findIndex(el =>
      el.dataset.scoreKey === nextFocusInfo.key &&
      Number(el.dataset.scoreMatch) === Number(nextFocusInfo.id) &&
      Number(el.dataset.scoreSet) === Number(nextFocusInfo.setIdx) &&
      Number(el.dataset.scoreSide) === Number(nextFocusInfo.side)
    );
    const target = inputs[idx + 1] || inputs[idx] || null;
    if(target){
      try { target.focus(); target.select(); } catch(e) {}
    }
  }

  function queueScoreSave(reason){
    if(typeof window.saveTournamentScoresRelationalV92 !== 'function') return;
    const h = scoreHash();
    lastQueuedHash = h;
    markLocalScoreEdit();
    clearTimeout(scoreSaveTimer);
    scoreSaveTimer = setTimeout(async function(){
      try{
        if(h === lastSavedHash){
          log('save.skip.sameHash', { reason });
          return;
        }
        markLocalScoreEdit();
        const ok = await window.saveTournamentScoresRelationalV92(false);
        if(ok !== false) lastSavedHash = h;
        markLocalScoreEdit(3500);
        log('save.done', { reason, changed: h !== lastSavedHash });
      }catch(e){
        console.warn('[TBK V103] Sauvegarde scores impossible', e);
      }
    }, SAVE_DELAY_MS);
  }

  function handleScoreInput(el, key, id, setIdx, side, immediate){
    const inputKey = [key,id,setIdx,side].join(':');
    clearTimeout(inputTimers[inputKey]);

    const value = el ? el.value : '';
    if(value !== '' && !/^\d{0,2}$/.test(String(value))){
      el.value = String(value).replace(/\D/g,'').slice(0,2);
    }

    const numeric = Number(el.value);
    const shouldCommitNow = immediate || el.value === '' || String(el.value).length >= 2 || (Number.isFinite(numeric) && numeric >= 10);
    const delay = shouldCommitNow ? 0 : 450;

    inputTimers[inputKey] = setTimeout(function(){
      nextFocusInfo = { key, id, setIdx, side };
      const ok = setScoreLocalOnly(key,id,setIdx,side,el.value);
      if(ok){
        queueScoreSave('score input');
        setTimeout(focusNextScoreField, 0);
        setTimeout(focusNextScoreField, 120);
      }
    }, delay);
  }

  window.tbkV103ScoreInputChanged = handleScoreInput;

  window.setScoreById = function(key,id,setIdx,side,val){
    nextFocusInfo = { key, id, setIdx:Number(setIdx), side:Number(side) };
    const ok = setScoreLocalOnly(key, id, Number(setIdx), Number(side), val);
    if(ok){
      queueScoreSave('setScoreById direct');
      setTimeout(focusNextScoreField, 0);
      setTimeout(focusNextScoreField, 120);
    }
    return ok;
  };

  window.scoreInputs = function(m){
    let locked = false, disabled = false, reason = '';
    try { locked = typeof isKOLockedByPools === 'function' && isKOLockedByPools(m); } catch(e) {}
    try { disabled = typeof canEditScores === 'function' ? !canEditScores(m) : false; } catch(e) { disabled = false; }
    try { reason = locked && typeof poolLockReason === 'function' ? poolLockReason(m) : (disabled && typeof absentTeamTitle === 'function' ? absentTeamTitle(m) : ''); } catch(e) {}

    const dis = disabled ? 'disabled' : '';
    const title = disabled ? ` title="${String(reason || '').replace(/"/g,'&quot;')}"` : '';
    const safeScores = m.scores || [[null,null],[null,null],[null,null]];

    return `<div class="score-line"${title}>${safeScores.map((s,i) => {
      const a = s && s[0] !== null && s[0] !== undefined ? s[0] : '';
      const b = s && s[1] !== null && s[1] !== undefined ? s[1] : '';
      return `<div class="score-set"><input class="score tbk-score-v103" type="number" inputmode="numeric" min="0" max="30" step="1" value="${a}" ${dis} data-score-key="${m.comp}" data-score-match="${m.id}" data-score-set="${i}" data-score-side="0" onfocus="this.select()" oninput="tbkV103ScoreInputChanged(this,'${m.comp}',${m.id},${i},0,false)" onkeydown="if(event.key==='Enter'){event.preventDefault();tbkV103ScoreInputChanged(this,'${m.comp}',${m.id},${i},0,true)}" onblur="tbkV103ScoreInputChanged(this,'${m.comp}',${m.id},${i},0,true)">-<input class="score tbk-score-v103" type="number" inputmode="numeric" min="0" max="30" step="1" value="${b}" ${dis} data-score-key="${m.comp}" data-score-match="${m.id}" data-score-set="${i}" data-score-side="1" onfocus="this.select()" oninput="tbkV103ScoreInputChanged(this,'${m.comp}',${m.id},${i},1,false)" onkeydown="if(event.key==='Enter'){event.preventDefault();tbkV103ScoreInputChanged(this,'${m.comp}',${m.id},${i},1,true)}" onblur="tbkV103ScoreInputChanged(this,'${m.comp}',${m.id},${i},1,true)"></div>`;
    }).join('')}</div>`;
  };

  const oldLoadScores = window.loadTournamentScoresRelationalV92;
  if(typeof oldLoadScores === 'function'){
    window.loadTournamentScoresRelationalV92 = async function(){
      if(Date.now() < (window.TBK_V103_SCORE_LOCAL_EDIT_UNTIL || 0)){
        log('realtime.refresh.skipLocalEdit', { until: window.TBK_V103_SCORE_LOCAL_EDIT_UNTIL });
        return false;
      }
      return await oldLoadScores.apply(this, arguments);
    };
  }

  const oldSaveScores = window.saveTournamentScoresRelationalV92;
  if(typeof oldSaveScores === 'function'){
    window.saveTournamentScoresRelationalV92 = async function(showMessage){
      const h = scoreHash();
      if(!showMessage && h === lastSavedHash){
        log('save.skip.noChange');
        return false;
      }
      markLocalScoreEdit();
      const res = await oldSaveScores.apply(this, arguments);
      if(res !== false) lastSavedHash = h;
      markLocalScoreEdit(3500);
      return res;
    };
  }

  // Appliquer le nouveau rendu scores au chargement si l'utilisateur est deja sur planning/poules.
  setTimeout(function(){
    try { if(typeof renderAll === 'function') renderAll(true); } catch(e) {}
  }, 900);
})();
