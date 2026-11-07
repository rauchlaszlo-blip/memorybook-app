import { pool } from './db';
import { createMemoryBookAuth } from './auth-factory';
const baseURL = process.env.BETTER_AUTH_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3001';
export const auth = process.env.BETTER_AUTH_SECRET ? createMemoryBookAuth({
  pool, baseURL, secret:process.env.BETTER_AUTH_SECRET,
  trustedOrigins:[baseURL,'http://localhost:5173','http://127.0.0.1:5173'],
  google:process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? {clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET}:undefined,
}) : null;
