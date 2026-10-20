// Infrastructure liveness only. Spec P22 / I-19: no member or environment data.
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(
    { status: 'ok', service: 'web' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
