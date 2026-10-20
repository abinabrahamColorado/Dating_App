import { it, expect } from 'vitest';
import { GET } from '../../apps/web/app/api/v1/health/route';
it('M0 web: health response exposes no member or environment data (Spec P22)', async () => {
  const response = GET();
  expect(await response.json()).toEqual({ status: 'ok', service: 'web' });
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});
