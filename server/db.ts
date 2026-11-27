import dotenv from 'dotenv';
import { Pool } from 'pg';
import {collectionDatabaseConfig} from './collection/database-isolation';

dotenv.config();

export const pool = new Pool(collectionDatabaseConfig());
