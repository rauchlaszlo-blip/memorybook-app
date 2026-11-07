// All M1 tooling is deliberately restricted to an acknowledged loopback database.
export function localDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.DATABASE_URL;
  if (!raw || env.WEDDING_LOCAL_DATABASE_ACK !== 'yes') throw new Error('LOCAL_DATABASE_ACK_REQUIRED');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !/^\/memorybook_wedding_(test|pilot)(_[a-z0-9_]+)?$/.test(url.pathname) ||
      url.search || url.hash || !['development', 'test'].includes(env.NODE_ENV || '')) {
    throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
  }
  return raw;
}
