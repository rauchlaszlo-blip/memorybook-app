const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

/** Deployment gate, independent of user consent and stored OAuth grants.
 * null means unrestricted local development only. Missing production configuration
 * and an explicitly empty value both disable access to every book.
 * Read on each operation: an older consent/token never broadens a newer policy.
 */
export function deploymentMcpBookIds(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const raw = env.MEMORYBOOK_MCP_ALLOWED_BOOK_IDS;
  if (raw === undefined) return ['test', 'development'].includes(env.NODE_ENV || '') ? null : [];
  if (!raw.trim()) return [];
  const ids = raw.split(',').map(id => id.trim().toLowerCase());
  if (ids.length > 100 || ids.some(id => !uuid.test(id))) throw new Error('INVALID_MCP_BOOK_ALLOWLIST');
  return [...new Set(ids)];
}

export function allowedMcpBookIds(grantedIds: readonly string[], env: NodeJS.ProcessEnv = process.env): string[] {
  const deploymentIds = deploymentMcpBookIds(env);
  return [...new Set(grantedIds.map(id => id.toLowerCase()))].filter(id => uuid.test(id) && (deploymentIds === null || deploymentIds.includes(id)));
}

export function deploymentAllowsMcpBook(bookId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return allowedMcpBookIds([bookId], env).length === 1;
}
