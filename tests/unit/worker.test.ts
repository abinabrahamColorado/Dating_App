import { it, expect } from 'vitest';
import { HEALTH_QUEUE, workerOptions } from '../../apps/worker/src/worker';
it('M0 worker: uses a distinct infrastructure queue schema', () => {
  expect(workerOptions('postgresql://localhost/db').schema).toBe('queue');
  expect(HEALTH_QUEUE).toBe('system.healthcheck');
  expect(() => workerOptions('sqlite:///db')).toThrow();
});
