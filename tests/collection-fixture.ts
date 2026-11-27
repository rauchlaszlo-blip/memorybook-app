import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {migrateCollection} from '../server/collection/schema';
/** Fictional local-test base matching the main application's columns used by collection. */
export async function initializeCollectionFixture(pool:Pool){await pool.query(`
 CREATE TABLE users(id TEXT PRIMARY KEY);
 CREATE TABLE books(id TEXT PRIMARY KEY,owner_user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,book_type TEXT NOT NULL DEFAULT 'event',event_is_open BOOLEAN DEFAULT TRUE,event_opens_at TIMESTAMPTZ,event_closes_at TIMESTAMPTZ);
 CREATE TABLE pages(id TEXT PRIMARY KEY,book_id TEXT NOT NULL REFERENCES books(id),page_number INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,canvas_json JSONB NOT NULL DEFAULT '{}',event_guest_data JSONB NOT NULL DEFAULT '{}',event_device_id TEXT,invite_token TEXT UNIQUE,invite_status TEXT NOT NULL DEFAULT 'draft',invite_created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,submitted_at TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,owner_visibility TEXT DEFAULT 'active',author_share_approved BOOLEAN DEFAULT FALSE,owner_share_approved BOOLEAN DEFAULT FALSE,preview_image_url TEXT);
 CREATE TABLE contributions(id TEXT PRIMARY KEY,book_id TEXT NOT NULL REFERENCES books(id),contributor_name TEXT,memory_text TEXT,photo_url TEXT,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
 `);await migrateCollection(pool);}
export async function seedCollectionPage(pool:Pool,options:{ownerId?:string;bookId?:string;pageId?:string;token?:string;device?:string;bookType?:string}={}){
 const ownerId=options.ownerId||'owner-a',bookId=options.bookId||'book-'+randomUUID(),pageId=options.pageId||'page-'+randomUUID(),token=options.token||'page-invite-'+randomUUID(),device=options.device||randomUUID();
 await pool.query('INSERT INTO users(id) VALUES($1) ON CONFLICT DO NOTHING',[ownerId]);await pool.query('INSERT INTO books(id,owner_user_id,title,book_type) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[bookId,ownerId,'Kitalált gyűjtési próba',options.bookType||'event']);
 await pool.query("INSERT INTO pages(id,book_id,invite_token,event_device_id,event_guest_data,canvas_json) VALUES($1,$2,$3,$4,$5,$6)",[pageId,bookId,token,device,{name:'Fiktív Vendég'},{objects:[{type:'IText',text:'Árvíztűrő üzenet'},{type:'Path',path:[['M',0,0],['L',10,10]]}]}]);return{ownerId,bookId,pageId,token,device};
}
