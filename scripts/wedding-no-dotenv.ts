import dotenv from 'dotenv';
// Only loaded by the explicit, loopback-only pilot launcher.
dotenv.config = () => ({ parsed: {} });
