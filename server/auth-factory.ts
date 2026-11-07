import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import type { Pool } from 'pg';
type MailSink = (kind: 'verification' | 'reset', email: string, url: string) => Promise<void>;
export function memoryBookAuthOptions(options: { pool: Pool; baseURL: string; secret: string; trustedOrigins: string[]; google?: {clientId:string;clientSecret:string}; testMail?: MailSink }) {
  const { pool, baseURL, secret, trustedOrigins, google, testMail } = options;
  return {
    database: pool, baseURL, secret, trustedOrigins,
    emailAndPassword: { enabled: true, ...(testMail ? {
      minPasswordLength: 10, revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({user,url}) => testMail('reset', user.email, url),
    } : {}) },
    ...(testMail ? { emailVerification: { sendOnSignUp: true, sendVerificationEmail: async ({user,url}: {user:{email:string};url:string}) => testMail('verification',user.email,url) } } : {}),
    user: { modelName:'users', fields:{ name:'display_name',email:'email',emailVerified:'email_verified',image:'image_url',createdAt:'created_at',updatedAt:'updated_at' } },
    session:{modelName:'auth_sessions'},
    account:{modelName:'auth_accounts',accountLinking:{enabled:true,trustedProviders:['google','email-password'],allowDifferentEmails:false}},
    verification:{modelName:'auth_verifications'},
    socialProviders: google ? {google} : {},
  } satisfies BetterAuthOptions;
}
export function createMemoryBookAuth(options:Parameters<typeof memoryBookAuthOptions>[0]) { return betterAuth(memoryBookAuthOptions(options)); }
