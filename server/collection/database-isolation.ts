import type {Pool,PoolConfig} from 'pg';

export const collectionPilotSchema='collection_pilot_20261127';
export const collectionPilotBook={id:'collection-wedding-pilot-20261127',ownerId:'collection-pilot-owner-20261127',title:'Esküvői anyaggyűjtés – fiktív próbakönyv'};

function pilotSchema(env:NodeJS.ProcessEnv){
  if(env.COLLECTION_PILOT_ENABLED!=='yes'){
    if(env.COLLECTION_DATABASE_SCHEMA)throw new Error('COLLECTION_SCHEMA_REQUIRES_PILOT');
    return null;
  }
  const schema=env.COLLECTION_DATABASE_SCHEMA;
  if(!schema||!/^[a-z][a-z0-9_]{0,62}$/.test(schema)||schema!==collectionPilotSchema)throw new Error('COLLECTION_PILOT_SCHEMA_REQUIRED');
  if(!/^[A-Za-z0-9_-]{43}$/.test(env.COLLECTION_PILOT_GUEST_TOKEN||''))throw new Error('COLLECTION_PILOT_GUEST_TOKEN_REQUIRED');
  return schema;
}

/** Keep normal/main connections unchanged. A dedicated pilot never falls back to public. */
export function collectionDatabaseConfig(env:NodeJS.ProcessEnv=process.env):PoolConfig{
  const schema=pilotSchema(env);if(!schema)return{connectionString:env.DATABASE_URL};
  if(!env.DATABASE_URL)throw new Error('COLLECTION_PILOT_DATABASE_REQUIRED');
  const connection=new URL(env.DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(connection.protocol))throw new Error('COLLECTION_PILOT_DATABASE_REQUIRED');
  // URL options take priority over PGOPTIONS and Pool.options in node-postgres.
  // Replace them explicitly, retaining existing TLS/connection parameters.
  connection.searchParams.set('options','-c search_path='+schema);
  return{connectionString:connection.toString(),max:3,options:'-c search_path='+schema};
}

async function assertPath(pool:Pool,schema:string,allowMissing=false){
  const result=(await pool.query("SELECT current_setting('search_path') AS requested,current_schema() AS selected,current_schemas(false)::text[] AS schemas")).rows[0];
  if(result.requested!==schema||(!allowMissing&&result.selected!==schema)||result.selected!==null&&result.selected!==schema||result.schemas.some((name:string)=>name!==schema))throw new Error('COLLECTION_PILOT_SCHEMA_NOT_ISOLATED');
}

/** Must run before every legacy initializer and before Better Auth migrations. */
export async function initializeCollectionDatabase(pool:Pool,env:NodeJS.ProcessEnv=process.env){
  const schema=pilotSchema(env);if(!schema)return;
  await assertPath(pool,schema,true);
  // The only schema this operator-controlled bootstrap may create is the approved new pilot schema.
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${collectionPilotSchema}"`);
  await assertPath(pool,schema);
}

/** Read-only evidence: values remain inside PostgreSQL; only counts/digests leave it. */
export async function collectionPublicSnapshot(pool:Pool,env:NodeJS.ProcessEnv=process.env){
  if(!pilotSchema(env))return null;
  const db=await pool.connect();
  try{
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables=(await db.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    const result=[];
    for(const table of tables){
      const name=String(table.tablename),quoted='"'+name.replaceAll('"','""')+'"';
      const row=(await db.query(`SELECT count(*)::text AS count,encode(sha256(convert_to(COALESCE(string_agg(digest,'' ORDER BY digest),''),'UTF8')),'hex') AS digest FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS digest FROM public.${quoted} t) fingerprints`)).rows[0];
      result.push({table:name,count:row.count,digest:row.digest});
    }
    await db.query('COMMIT');return result;
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}

/** Seed only the new schema. Existing owner/book/event settings are never overwritten on restart. */
export async function seedCollectionPilot(pool:Pool,env:NodeJS.ProcessEnv=process.env){
  const schema=pilotSchema(env);if(!schema)return;await assertPath(pool,schema);
  const db=await pool.connect();
  try{
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(61127,1)');
    await db.query(`INSERT INTO users(id,display_name,email,email_verified) VALUES($1,$2,$3,FALSE) ON CONFLICT(id) DO NOTHING`,[collectionPilotBook.ownerId,'Fiktív anyaggyűjtő tulajdonos','collection-pilot-20261127@example.invalid']);
    await db.query(`INSERT INTO books(id,owner_user_id,title,book_type,invite_token,event_device_limit,event_identity_mode,event_required_fields,event_is_open,page_capacity,language)
      VALUES($1,$2,$3,'event',$4,100,'none','["name"]'::jsonb,TRUE,0,'hu') ON CONFLICT(id) DO NOTHING`,[collectionPilotBook.id,collectionPilotBook.ownerId,collectionPilotBook.title,env.COLLECTION_PILOT_GUEST_TOKEN]);
    await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
