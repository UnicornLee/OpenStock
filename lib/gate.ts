/**
 * Candle data for the self-hosted chart.
 *
 * TradingView's embed is the only source of OHLC data OpenStock had, and it cannot show
 * a Pine script the account is not allowed to publish. Gate.io's public REST API is used
 * instead: it needs no key, serves crypto pairs (including the XAUT gold pair), and every
 * resolution TradingView offers is available.
 */

export type Candle = {
    time: number; // unix seconds
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

const GATE_BASE = 'https://api.gateio.ws/api/v4';

export const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const;
export type Interval = (typeof INTERVALS)[number];

/** Gate's own interval names, which differ slightly from TradingView's. */
const GATE_INTERVAL: Record<Interval, string> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '4h': '4h',
    '1d': '1d',
};

/**
 * Maps a TradingView symbol to a Gate spot pair.
 * `BINANCE:BTCUSDT` -> `BTC_USDT`, `BINANCE:XAUTUSDT` -> `XAUT_USDT`.
 */
export const toGatePair = (symbol: string): string | null => {
    const clean = symbol.trim().toUpperCase();
    const [exchange, ticker] = clean.includes(':') ? clean.split(':') : ['', clean];
    // A bare symbol like `BTCUSDT` is treated as a crypto pair.
    const base = ticker || exchange;
    if (!base) return null;
    if (!/^[A-Z0-9]{4,20}$/.test(base)) return null;
    if (base.endsWith('USDT')) return `${base.slice(0, -4)}_USDT`;
    if (base.endsWith('USDC')) return `${base.slice(0, -4)}_USDC`;
    if (base.endsWith('BTC')) return `${base.slice(0, -3)}_BTC`;
    return `${base}_USDT`;
};

export type FetchResult = { ok: true; candles: Candle[] } | { ok: false; error: string };

/**
 * Fetches candles from Gate.io.
 *
 * `limit` is capped at 1000 (the API maximum per call). To get more history the range is
 * walked backwards in `window` sized steps, oldest data first.
 */
export const fetchCandles = async (
    symbol: string,
    interval: Interval = '5m',
    limit = 500,
    window = 1000,
): Promise<FetchResult> => {
    const pair = toGatePair(symbol);
    if (!pair) return { ok: false, error: `unsupported symbol: ${symbol}` };

    const stepSeconds = intervalSeconds(interval);
    const want = Math.min(Math.max(limit, 1), 5000);
    const collected: Candle[] = [];
    let to = Math.floor(Date.now() / 1000);

    try {
        while (collected.length < want) {
            const size = Math.min(window, want - collected.length);
            const from = to - stepSeconds * size;
            const url = `${GATE_BASE}/spot/candlesticks?currency_pair=${encodeURIComponent(pair)}&interval=${GATE_INTERVAL[interval]}&limit=${size}&from=${from}&to=${to}`;
            const res = await fetch(url, {
                headers: { Accept: 'application/json' },
                // A short cache keeps a wall of charts from hammering the API.
                next: { revalidate: 30 },
            });
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                return { ok: false, error: `gate.io ${res.status}: ${body.slice(0, 160)}` };
            }
            const raw = (await res.json()) as string[][];
            if (!Array.isArray(raw) || raw.length === 0) break;

            const batch: Candle[] = raw
                .map((row) => ({
                    time: Number(row[0]),
                    open: Number(row[5]),
                    high: Number(row[3]),
                    low: Number(row[4]),
                    close: Number(row[2]),
                    volume: Number(row[6]),
                }))
                .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close))
                .sort((a, b) => a.time - b.time);

            // The API may repeat the bar at the window edge; keep the newest copy only.
            const seen = new Set<number>();
            for (const c of batch) {
                if (seen.has(c.time)) continue;
                seen.add(c.time);
                collected.push(c);
            }

            const oldest = batch[0]?.time ?? to;
            if (oldest >= to - stepSeconds) break; // no progress, stop
            to = oldest - 1;
        }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    collected.sort((a, b) => a.time - b.time);
    return { ok: true, candles: collected.slice(-want) };
};

export const intervalSeconds = (interval: Interval): number => {
    switch (interval) {
        case '1m': return 60;
        case '5m': return 300;
        case '15m': return 900;
        case '30m': return 1800;
        case '1h': return 3600;
        case '4h': return 14400;
        case '1d': return 86400;
        default: return 300;
    }
};

/** TradingView-style interval names used by the monitor wall UI. */
export const TV_INTERVALS: { id: Interval; label: string }[] = [
    { id: '1m', label: '1m' },
    { id: '5m', label: '5m' },
    { id: '15m', label: '15m' },
    { id: '30m', label: '30m' },
    { id: '1h', label: '1H' },
    { id: '4h', label: '4H' },
    { id: '1d', label: '1D' },
];
