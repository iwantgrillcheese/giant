import { fetchBoard, isAuthorized } from './_shared.mjs';
import { fetchKalshiNFLRows } from './_kalshi.mjs';

export async function GET(request) {
  if (!isAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  try {
    const url = new URL(request.url);
    const [sgoResult, kalshiResult] = await Promise.allSettled([
      fetchBoard(url),
      fetchKalshiNFLRows()
    ]);

    if (sgoResult.status === 'rejected' && kalshiResult.status === 'rejected') {
      throw sgoResult.reason || kalshiResult.reason || new Error('All market feeds failed');
    }

    const sgo = sgoResult.status === 'fulfilled' ? sgoResult.value : { rows: [], demo: false, provider: 'SportsGameOdds unavailable' };
    const kalshi = kalshiResult.status === 'fulfilled' ? kalshiResult.value : { rows: [], milestoneCount: 0, eventCount: 0 };
    const rows = [...(kalshi.rows || []), ...(sgo.rows || [])].sort((a, b) => {
      const ap = a.bestPrediction ? 1 : 0;
      const bp = b.bestPrediction ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return new Date(a.startTime || 0) - new Date(b.startTime || 0);
    });

    return Response.json({
      ...sgo,
      rows,
      provider: kalshi.rows?.length ? `${sgo.provider || 'SportsGameOdds'} + Kalshi direct` : (sgo.provider || 'SportsGameOdds'),
      kalshiRowCount: kalshi.rows?.length || 0,
      kalshiEventCount: kalshi.eventCount || 0,
      partialFeedError: [
        sgoResult.status === 'rejected' ? `SportsGameOdds: ${sgoResult.reason?.message || 'failed'}` : null,
        kalshiResult.status === 'rejected' ? `Kalshi: ${kalshiResult.reason?.message || 'failed'}` : null
      ].filter(Boolean).join(' | ') || null
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { error: error?.message || 'Failed to load odds' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
