import { betterAuth } from 'better-auth';
import { pool } from './db';

const baseURL =
  process.env.BETTER_AUTH_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  'http://localhost:3001';

const trustedOrigins = [
  baseURL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
].filter(Boolean);

const googleEnabled =
  Boolean(process.env.GOOGLE_CLIENT_ID) &&
  Boolean(process.env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  database: pool,
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
  },
  user: {
    modelName: 'users',
    fields: {
      name: 'display_name',
      email: 'email',
      emailVerified: 'email_verified',
      image: 'image_url',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  session: {
    modelName: 'auth_sessions',
  },
  account: {
    modelName: 'auth_accounts',
    accountLinking: {
      enabled: true,
      trustedProviders: ['google', 'email-password'],
      allowDifferentEmails: false,
    },
  },
  verification: {
    modelName: 'auth_verifications',
  },
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        },
      }
    : {},
});
