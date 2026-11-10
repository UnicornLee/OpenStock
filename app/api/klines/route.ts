import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/better-auth/auth';
import { fetchCandles, INTERVALS, type Interval } from '@/lib/gate';

// Candles come from Gate.io's public API. Signed-in only, so the wall cannot be used as an
// open relay, and the interval is whitelisted to keep the cache key small.
const SYMBOL_PATTERN = /^[A-Z0-9.:\-]{1,24}$/;
const MAX_LIMIT = 3000;

export async function GET(req: NextRequest) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const symbol = (req.nextUrl.searchParams.get('symbol') ?? '').trim().toUpperCase();
    const intervalParam = (req.nextUrl.searchParams.get('interval') ?? '5m').trim();
    const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? 500);

    if (!SYMBOL_PATTERN.test(symbol)) {
        return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
    }
    if (!INTERVALS.includes(intervalParam as Interval)) {
        return NextResponse.json({ error: 'Invalid interval' }, { status: 400 });
    }
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), MAX_LIMIT) : 500;

    const result = await fetchCandles(symbol, intervalParam as Interval, limit);
    if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json(
        { symbol, interval: intervalParam, candles: result.candles },
        { headers: { 'Cache-Control': 'private, max-age=20' } },
    );
}
