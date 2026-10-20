import { it, expect } from 'vitest';
import { openDatabase } from '../../packages/db/src/client';
it('M0 db: rejects database substitution before opening a connection', () => {
  expect(() => openDatabase('sqlite:///local.db')).toThrow('PostgreSQL is required');
});
