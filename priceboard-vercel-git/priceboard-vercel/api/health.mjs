import { health } from './_shared.mjs';

export function GET() {
  return Response.json(health(), {
    headers: { 'Cache-Control': 'no-store' }
  });
}
