export function pilotConfig(env: NodeJS.ProcessEnv) {
  if (env.MEMORYBOOK_INTERNET_PILOT !== 'isolated-text-v1' || env.PILOT_DATABASE_ACK !== 'isolated-fictional-only') throw new Error('Explicit isolated pilot configuration required');
  const db = new URL(env.DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !/^\/memorybook_wedding_internet_pilot(?:_[a-z0-9]+)?$/.test(db.pathname) || db.search || db.hash) throw new Error('Dedicated pilot database required');
  if (env.WEDDING_PILOT_PASSWORDLESS === 'true') throw new Error('Local passwordless mode forbidden on internet pilot');
  const url = new URL(env.PUBLIC_APP_URL || env.RENDER_EXTERNAL_URL || '');
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.onrender.com') || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw new Error('Canonical Render HTTPS origin required');
  return { databaseUrl: db.toString(), origin: url.origin };
}
