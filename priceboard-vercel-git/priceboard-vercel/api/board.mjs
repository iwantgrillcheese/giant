import { fetchBoard, isAuthorized } from './_shared.mjs';

export async function GET(request) {
  if (!isAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  try {
    const data = await fetchBoard(new URL(request.url));
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to load odds' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
