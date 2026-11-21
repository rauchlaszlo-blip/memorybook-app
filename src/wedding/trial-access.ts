import {useEffect,useState} from 'react';

export type TrialAccess={bookId:string;expiresAt:string};
type TrialCapability={trial?:TrialAccess};
export function useTrialAccess(){
  const [access,setAccess]=useState<{loaded:boolean;trial:TrialAccess|null;denied:boolean}>({loaded:false,trial:null,denied:false});
  useEffect(()=>{
    let active=true;
    void fetch('/api/wedding/capabilities',{credentials:'same-origin'}).then(async response=>{
      if(!response.ok){
        const result=await response.json().catch(()=>({error:''}));
        if(active)setAccess({loaded:false,trial:null,denied:result.error==='TRIAL_SCOPE_DENIED'});
        return;
      }
      const caps=await response.json() as TrialCapability;
      if(active)setAccess({loaded:true,trial:caps.trial||null,denied:false});
    }).catch(()=>{if(active)setAccess({loaded:false,trial:null,denied:false});});
    return()=>{active=false;};
  },[]);
  return access;
}
