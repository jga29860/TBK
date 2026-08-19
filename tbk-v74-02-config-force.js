/* TBK V74 - module externalise : tbk-v74-02-config-force.js */
// V70 - Force la configuration Supabase depuis le fichier externe tbk-supabase-config.js.
// Les valeurs du fichier externe deviennent prioritaires a chaque ouverture.
// Si dbPassword est vide dans le fichier externe, le mot de passe deja saisi dans ce navigateur est conserve.
(function(){
  const CONFIG_STORAGE_KEY = 'tbk_supabase_shared_config_v66';
  const external = window.TBK_SUPABASE_CONFIG || {};
  let previous = {};
  try { previous = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || '{}'); } catch(e) { previous = {}; }
  const forced = {
    url: external.url || '',
    anonKey: external.anonKey || '',
    dbEmail: external.dbEmail || '',
    dbPassword: external.dbPassword || previous.dbPassword || '',
    seasonLabel: external.seasonLabel || '2026-2027',
    forcedFromExternalFile: true,
    forcedAt: new Date().toISOString()
  };
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(forced));
  window.TBK_SUPABASE_FORCED_CONFIG_STATUS = {
    applied: true,
    hasUrl: !!forced.url,
    hasAnonKey: !!forced.anonKey,
    hasDbEmail: !!forced.dbEmail,
    hasDbPassword: !!forced.dbPassword,
    seasonLabel: forced.seasonLabel
  };
})();
