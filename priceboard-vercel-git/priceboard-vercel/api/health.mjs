import { health, isAuthorized } from './_shared.mjs';

export function GET(request) {
  if (!isAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  return Response.json(health(), { headers: { 'Cache-Control': 'no-store' } });
}
