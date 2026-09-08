import { createAuthClient } from 'better-auth/react';

const baseURL =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : window.location.origin;

export const authClient = createAuthClient({
  baseURL,
});
