import type { Pool } from 'pg';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { getMigrations } from 'better-auth/db/migration';
import { memoryBookAuthOptions } from '../auth-factory';
import { betterAuth } from 'better-auth';
export function decryptTestMail(secret:string, value:string) {
  const [iv,tag,data]=value.split('.');const cipher=createDecipheriv('aes-256-gcm',createHash('sha256').update(secret).digest(),Buffer.from(iv,'hex'));
  cipher.setAuthTag(Buffer.from(tag,'hex'));return Buffer.concat([cipher.update(Buffer.from(data,'hex')),cipher.final()]).toString();
}
export async function createCommerceAuth(pool:Pool,origin:string) {
  await pool.query("INSERT INTO pilot_commerce_settings(key,value) VALUES('auth_secret',$1) ON CONFLICT DO NOTHING",[randomBytes(48).toString('hex')]);
  const secret=(await pool.query("SELECT value FROM pilot_commerce_settings WHERE key='auth_secret'")).rows[0].value as string;
  const options=memoryBookAuthOptions({pool,baseURL:origin,secret,trustedOrigins:[origin],testMail:async(kind,email,url)=>{
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(secret).digest(),iv);
    const data=Buffer.concat([cipher.update(url,'utf8'),cipher.final()]);
    await pool.query("DELETE FROM pilot_test_mail WHERE expires_at<CURRENT_TIMESTAMP");
    await pool.query("INSERT INTO pilot_test_mail(id,recipient,kind,encrypted_url,expires_at) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP+interval '1 hour')",[randomUUID(),email,kind,`${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${data.toString('hex')}`]);
  }});
  const {runMigrations}=await getMigrations(options);await runMigrations();
  const auth=betterAuth(options);
  return {auth,secret};
}
export type CommerceAuth = Awaited<ReturnType<typeof createCommerceAuth>>;
