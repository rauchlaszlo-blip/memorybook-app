export type Billing = {kind:'person'|'company';name:string;postalCode:string;city:string;address:string;taxNumber?:string;country:'HU';email:string};
export function validateBilling(value:unknown,email:string):Billing|null {
  if(!value || typeof value!=='object')return null;const b=value as Record<string,unknown>;
  const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max&&!Array.from(v).some(c=>c.charCodeAt(0)<32)?v.trim():null;
  const name=text(b.name,160),city=text(b.city,100),address=text(b.address,200);
  if(!['person','company'].includes(String(b.kind))||!name||!city||!address||typeof b.postalCode!=='string'||!/^\d{4}$/.test(b.postalCode))return null;
  if(b.kind==='company' && (typeof b.taxNumber!=='string'||!/^\d{8}-[1-5]-\d{2}$/.test(b.taxNumber)))return null;
  return {kind:b.kind as Billing['kind'],name,city,address,postalCode:b.postalCode,country:'HU',email,...(b.kind==='company'?{taxNumber:String(b.taxNumber)}:{})};
}
// Provider seam. No NAV claim or outbound lookup without a configured adapter.
export interface CompanyLookup { lookup(taxNumber:string):Promise<{status:'found';name:string;address:string}|{status:'unavailable'|'not_found'}> }
export const manualCompanyLookup:CompanyLookup={lookup:async()=>({status:'unavailable'})};
