// Standalone pilot: never imports legacy server, auth, billing or dotenv startup.
import { Pool } from 'pg';
import { pilotConfig } from './config';
import { createPilotApp } from './app';
import { migratePilot, seedOperatorInvite } from './auth';
import { migrateWedding } from '../wedding/migrate';
const config = pilotConfig(process.env);
const pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
await migrateWedding(pool);
await migratePilot(pool);
await seedOperatorInvite(pool, process.env);
const app = createPilotApp(pool, config.origin);
const server = app.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log('Isolated text pilot ready'));
process.on('SIGTERM', () => { server.close(() => { void pool.end().then(() => process.exit(0)); }); });
