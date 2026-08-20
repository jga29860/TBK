(function(){
'use strict';
let session=null,profile=null,allowedPages=[],profileError=null;
const db=()=>TBK_DB.get();

async function loadProfile(){
  if(!session){profile=null;allowedPages=[];profileError=null;return null;}
  const q=await db().from('tbk_user_profiles')
    .select('user_id,display_name,profile_code,active')
    .eq('user_id',session.user.id)
    .maybeSingle();
  if(q.error){profileError=q.error;throw q.error;}
  if(!q.data){
    profile=null;allowedPages=[];
    profileError=new Error('Session active, mais profil applicatif absent. Exécutez sql/01_repair_admin_profile.sql dans Supabase.');
    return null;
  }
  if(q.data.active===false){
    profile=null;allowedPages=[];
    profileError=new Error('Session active, mais profil applicatif désactivé.');
    return null;
  }
  profile=q.data;
  const r=await db().from('tbk_profile_page_permissions')
    .select('page_key')
    .eq('profile_code',profile.profile_code)
    .eq('can_view',true);
  if(r.error){profileError=r.error;throw r.error;}
  allowedPages=(r.data||[]).map(x=>x.page_key);
  profileError=null;
  return profile;
}

async function refreshProfile(){
  try{return await loadProfile();}
  catch(e){console.error('[TBK AUTH] Chargement profil impossible',e);profile=null;allowedPages=[];profileError=e;return null;}
}

async function init(){
  const r=await db().auth.getSession();
  if(r.error)throw r.error;
  session=r.data.session;
  if(session)await refreshProfile();
  db().auth.onAuthStateChange(async(event,s)=>{
    session=s;
    if(event==='SIGNED_OUT'||!s){profile=null;allowedPages=[];profileError=null;}
    else await refreshProfile();
    if(window.TBK_APP)TBK_APP.render();
  });
}

async function login(loginName,password){
  const name=String(loginName||'').trim();
  if(!name||!password)throw new Error('Nom affiché et mot de passe obligatoires.');
  const resolved=await db().functions.invoke('tbk-resolve-login',{body:{login_name:name}});
  if(resolved.error||!resolved.data?.email)throw new Error('Connexion impossible. Vérifiez vos identifiants.');
  const r=await db().auth.signInWithPassword({email:resolved.data.email,password});
  if(r.error)throw new Error('Connexion impossible. Vérifiez vos identifiants.');
  session=r.data.session;
  await refreshProfile();
}
async function logout(){await db().auth.signOut();session=null;profile=null;allowedPages=[];profileError=null;}
function canAdmin(){return profile?.profile_code==='administrateur';}
function canView(page){return page==='home'||canAdmin()||allowedPages.includes(page);}
window.TBK_AUTH={init,login,logout,refreshProfile,session:()=>session,profile:()=>profile,profileError:()=>profileError,canAdmin,canView,pages:()=>allowedPages};
})();
