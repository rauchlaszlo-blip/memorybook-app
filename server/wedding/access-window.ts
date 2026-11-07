import type { Request, Response } from 'express';
import { randomBytes, createHash } from 'node:crypto';
export const accessSql = (alias='') => {
  const p=alias?alias+'.':'';
  return `CASE WHEN ${p}closed_at IS NOT NULL THEN 'closed' WHEN ${p}submission_start IS NOT NULL AND COALESCE(${p}pilot_clock,CURRENT_TIMESTAMP)<${p}submission_start THEN 'early' WHEN ${p}submission_end IS NOT NULL AND COALESCE(${p}pilot_clock,CURRENT_TIMESTAMP)>=${p}submission_end THEN 'ended' ELSE 'open' END`;
};
const deviceCookie='memorybook-guest-device';
export function guestDevice(req:Request,res?:Response) {
  const raw=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(deviceCookie+'='))?.slice(deviceCookie.length+1);
  if(raw && /^[A-Za-z0-9_-]{43}$/.test(raw))return createHash('sha256').update(raw).digest('hex');
  if(res){const token=randomBytes(32).toString('base64url');res.cookie(deviceCookie,token,{httpOnly:true,secure:req.secure || process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:365*86400_000});return createHash('sha256').update(token).digest('hex');}
  return null;
}
