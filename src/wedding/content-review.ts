import type {ReviewCategory,ReviewDecision,ReviewItem} from '../../shared/content-review';
export type {ReviewCategory,ReviewDecision,ReviewScope,ReviewItem} from '../../shared/content-review';
export type {ReviewState as ReviewData,ReviewDraftPolicy as ContentReviewStatus} from '../../shared/content-review';
export const reviewCategoryLabels:Record<ReviewCategory,string>={possible_sexual:'Lehetséges meztelenség vagy szexuális tartalom',possible_extremist:'Lehetséges önkényuralmi vagy szélsőséges jelkép',offensive_text:'Trágár, sértő szöveg'};
export const reviewDecisionLabels:Record<ReviewDecision,string>={false_positive:'Téves jelzés',allowed:'Felhasználható',private_only:'Csak privát könyvbe',omit:'Kihagyás a könyvből'};
export const hasReviewFlag=(item:ReviewItem)=>item.flags.length>0||item.categories.length>0;
export const reviewPending=(item:ReviewItem)=>hasReviewFlag(item)&&(!item.decision||item.contentChanged);
export async function reviewRequest<T>(url:string,body?:unknown):Promise<T>{
  const response=await fetch(url,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const messages:Record<string,string>={UNAUTHENTICATED:'Az átnézéshez tulajdonosi bejelentkezés szükséges.',CONTENT_CHANGED:'Azóta megváltozott a tartalom. Frissítsd az átnézési listát.',CONTENT_REVIEW_CONFLICT:'Azóta megváltozott a tartalom. Frissítsd az átnézési listát, majd a látható tartalomról dönts.',IDEMPOTENCY_CONFLICT:'A kérés tartalma megváltozott. Frissítsd a listát, és indíts új műveletet.',CONTENT_REVIEW_REQUIRED:'A tartalom átnézése és a konkrét változat új jóváhagyása szükséges.',CONTENT_REVIEW_BLOCKED:'A tervben még függő vagy ebben a kiadásban nem használható tartalom szerepel.'};throw new Error(messages[data.error]||'Az átnézési művelet nem sikerült. A tartalom megmaradt; próbáld újra.');}
  return data as T;
}
