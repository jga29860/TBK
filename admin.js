(function(){
'use strict';
const db=()=>TBK_DB.get();let profiles=[],users=[],pages=[],permissions=[];
function assertAdmin(){if(!TBK_AUTH.canAdmin())throw new Error('Action réservée au profil administrateur.');}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function isTransient(message){return /failed to send|fetch|network|timeout|temporar|indisponible/i.test(message||'');}

async function load(){assertAdmin();const qs=await Promise.all([db().from('tbk_profiles').select('*').order('label'),db().from('tbk_user_profiles').select('user_id,login_name,display_name,email,profile_code,active,created_at,updated_at').order('display_name'),db().from('tbk_pages').select('*').eq('active',true).order('sort_order'),db().from('tbk_profile_page_permissions').select('*')]);for(const q of qs)if(q.error)throw q.error;[profiles,users,pages,permissions]=qs.map(q=>q.data||[]);return{profiles,users,pages,permissions};}
function canView(pc,pk){return permissions.some(x=>x.profile_code===pc&&x.page_key===pk&&x.can_view);}

async function invokeOnce(action,payload){
  const {data,error}=await db().functions.invoke('tbk-admin-users',{body:{action,...payload}});
  if(error){
    let message=error.message||'Service administrateur indisponible';
    try{if(error.context){const detail=await error.context.json();message=detail?.error||detail?.message||message;}}catch(parseError){console.warn('[TBK_ADMIN] Réponse d’erreur illisible.',parseError);}
    const wrapped=new Error(message);wrapped.cause=error;throw wrapped;
  }
  if(!data?.success)throw new Error(data?.error||'Opération impossible');
  return data;
}

async function invoke(action,payload={}){
  assertAdmin();
  const session=TBK_AUTH.session?.();
  if(!session?.access_token)throw new Error('Votre session administrateur a expiré. Reconnectez-vous avant de relancer l’opération.');
  try{return await invokeOnce(action,payload);}
  catch(error){
    console.error('[TBK_ADMIN] Échec Edge Function.',{action,message:error.message,error});
    if(isTransient(error.message)){
      await wait(700);
      try{return await invokeOnce(action,payload);}
      catch(retryError){console.error('[TBK_ADMIN] Échec après nouvelle tentative.',{action,message:retryError.message,retryError});throw new Error('Le service d’administration Supabase ne répond pas après deux tentatives. Vérifiez le déploiement et les journaux de la fonction « tbk-admin-users ». Détail : '+retryError.message);}
    }
    throw error;
  }
}

async function createUser(x){await invoke('create',x);return load();}
async function updateUser(userId,patch){await invoke('update',{user_id:userId,...patch});return load();}
async function resetPassword(userId,password){await invoke('password',{user_id:userId,password});return load();}
async function deleteUser(userId){await invoke('delete',{user_id:userId});return load();}
async function createProfile(x){assertAdmin();const code=String(x.profile_code||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'');const label=String(x.label||'').trim();if(!code||!label)throw new Error('Code et libellé obligatoires.');const q=await db().from('tbk_profiles').insert({profile_code:code,label,description:x.description||'',active:true,system_profile:false});if(q.error)throw q.error;const r=await db().from('tbk_profile_page_permissions').insert(pages.map(p=>({profile_code:code,page_key:p.page_key,can_view:false})));if(r.error)throw r.error;return load();}
async function updateProfile(code,patch){assertAdmin();if(code==='administrateur'&&(patch.active===false||patch.profile_code))throw new Error('Le profil Administrateur est protégé.');const q=await db().from('tbk_profiles').update({...patch,updated_at:new Date().toISOString()}).eq('profile_code',code);if(q.error)throw q.error;return load();}
async function deleteProfile(code){assertAdmin();if(['administrateur','bureau'].includes(code))throw new Error('Les profils système ne peuvent pas être supprimés.');if(users.some(u=>u.profile_code===code))throw new Error('Ce profil est encore rattaché à un ou plusieurs utilisateurs.');const q=await db().from('tbk_profiles').delete().eq('profile_code',code);if(q.error)throw q.error;return load();}
async function setPageAccess(pc,pk,v){assertAdmin();if(pc==='administrateur'&&!v)throw new Error('Administrateur conserve tous les accès.');const q=await db().from('tbk_profile_page_permissions').upsert({profile_code:pc,page_key:pk,can_view:!!v,updated_at:new Date().toISOString()},{onConflict:'profile_code,page_key'});if(q.error)throw q.error;return load();}
window.TBK_ADMIN={load,createUser,updateUser,resetPassword,deleteUser,createProfile,updateProfile,deleteProfile,setPageAccess,canView,profiles:()=>profiles,users:()=>users,pages:()=>pages};
})();
