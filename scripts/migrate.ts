import 'dotenv/config';
import { migrate } from '../packages/db/src/migrate';
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
await migrate(url);
process.stdout.write('Schema migrations applied.\n');
