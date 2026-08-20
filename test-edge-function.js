(function(){
'use strict';
const db=()=>TBK_DB.get();

async function testEdgeFunction(){
  try{
    const session=TBK_AUTH.session?.();
    if(!session?.access_token){return{success:false,message:'Session administrateur absente ou expirée.'};}
    const {data,error}=await db().functions.invoke('tbk-admin-users',{body:{action:'ping'}});
    if(error){
      let message=error.message||'Edge Function indisponible';
      try{if(error.context){const detail=await error.context.json();message=detail?.error||detail?.message||message;}}catch(parseError){console.warn('[TBK_TEST_EDGE] Réponse illisible.',parseError);}
      return{success:false,message};
    }
    return{success:data?.success!==false,result:data??null};
  }catch(error){
    console.error('[TBK_TEST_EDGE]',error);
    return{success:false,message:error?.message||'Erreur inconnue'};
  }
}

window.TBK_TEST_EDGE={testEdgeFunction};
})();
