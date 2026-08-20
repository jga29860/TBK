(function(){
'use strict';

async function checkSession(){
  try{
    const session=TBK_AUTH.session?.();
    if(!session){return{ok:false,message:'Aucune session trouvée'};}
    return{
      ok:!!session.user?.id&&!!session.access_token,
      userId:session.user?.id||null,
      email:session.user?.email||null,
      token:!!session.access_token,
      expiresAt:session.expires_at||null
    };
  }catch(error){
    console.error('[TBK_TEST_SESSION]',error);
    return{ok:false,message:error?.message||'Erreur inconnue'};
  }
}

window.TBK_TEST_SESSION={checkSession};
})();
