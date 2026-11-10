/**
 * Pine Script v6 technical-analysis primitives, ported to TypeScript.
 *
 * The semantics follow TradingView's `ta.*` namespace closely enough for the indicators
 * shipped in `lib/pine/indicators.ts`: series are plain arrays indexed by bar, and `NaN`
 * marks a bar where a value does not exist yet (Pine's `na`).
 *
 * Unlike Pine, `sma`/`ema`/... receive the whole series at once instead of being called
 * bar by bar. That keeps the indicator definitions declarative and cheap to test.
 */

export type Series = number[];

/** Pine's `na`: a value that does not exist at this bar. */
export const NA = Number.NaN;

export const isNa = (v: number): boolean => Number.isNaN(v);

/** A stable NaN-filled series of the same length as `source`. */
const blank = (source: Series): Series => source.map(() => NA);

/**
 * Pine's `nz(x, replacement)`: replaces `na` with a fallback.
 * With no fallback given it returns 0, like Pine does.
 */
export const nz = (v: number, replacement = 0): number => (Number.isNaN(v) ? replacement : v);

/** Pine's `na(x)` / `nz` pair used as a boolean test. */
export const isNaAt = (v: number): boolean => Number.isNaN(v);

// ---------------------------------------------------------------------------
// Moving averages
// ---------------------------------------------------------------------------

/** Pine `ta.sma(source, length)`. */
export const sma = (source: Series, length: number): Series => {
    const out = blank(source);
    if (length <= 0) return out;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < source.length; i++) {
        const v = source[i];
        if (Number.isNaN(v)) {
            sum = 0;
            count = 0;
            continue;
        }
        sum += v;
        count++;
        if (count > length) {
            sum -= source[i - length];
            count = length;
        }
        if (count === length) out[i] = sum / length;
    }
    return out;
};

/**
 * Pine `ta.ema(source, length)`: seeded with the first SMA of `length` values,
 * exactly like the reference implementation.
 */
export const ema = (source: Series, length: number): Series => {
    const out = blank(source);
    if (length <= 0) return out;
    const alpha = 2 / (length + 1);
    let sum = 0;
    let count = 0;
    let prev = NA;
    for (let i = 0; i < source.length; i++) {
        const v = source[i];
        if (Number.isNaN(v)) {
            // A gap resets the seed, mirroring Pine's behaviour on `na` input.
            prev = NA;
            sum = 0;
            count = 0;
            continue;
        }
        if (Number.isNaN(prev)) {
            sum += v;
            count++;
            if (count === length) {
                prev = sum / length;
                out[i] = prev;
            }
            continue;
        }
        prev = alpha * v + (1 - alpha) * prev;
        out[i] = prev;
    }
    return out;
};

/**
 * Pine `ta.rma(source, length)`: Wilder's smoothing, the average TradingView uses
 * for RSI and ATR.
 */
export const rma = (source: Series, length: number): Series => {
    const out = blank(source);
    if (length <= 0) return out;
    let sum = 0;
    let count = 0;
    let prev = NA;
    for (let i = 0; i < source.length; i++) {
        const v = source[i];
        if (Number.isNaN(v)) {
            prev = NA;
            sum = 0;
            count = 0;
            continue;
        }
        if (Number.isNaN(prev)) {
            sum += v;
            count++;
            if (count === length) {
                prev = sum / length;
                out[i] = prev;
            }
            continue;
        }
        prev = (prev * (length - 1) + v) / length;
        out[i] = prev;
    }
    return out;
};

/** Pine `ta.wma(source, length)`: linearly weighted moving average. */
export const wma = (source: Series, length: number): Series => {
    const out = blank(source);
    if (length <= 0) return out;
    const denom = (length * (length + 1)) / 2;
    for (let i = length - 1; i < source.length; i++) {
        let sum = 0;
        let ok = true;
        for (let j = 0; j < length; j++) {
            const v = source[i - length + 1 + j];
            if (Number.isNaN(v)) {
                ok = false;
                break;
            }
            sum += v * (j + 1);
        }
        if (ok) out[i] = sum / denom;
    }
    return out;
};

/** Pine `ta.vwma(source, length)`. */
export const vwma = (source: Series, volume: Series, length: number): Series => {
    const pv = source.map((v, i) => (Number.isNaN(v) ? NA : v * nz(volume[i])));
    const vSum = sma(volume, length);
    const numerator = sma(pv, length);
    return numerator.map((v, i) => (Number.isNaN(v) || Number.isNaN(vSum[i]) || vSum[i] === 0 ? NA : v / vSum[i]));
};

/** Pine `ta.hma(source, length)`: Hull moving average. */
export const hma = (source: Series, length: number): Series => {
    const half = wma(source, Math.max(1, Math.floor(length / 2)));
    const full = wma(source, length);
    const diff = half.map((v, i) => (Number.isNaN(v) || Number.isNaN(full[i]) ? NA : 2 * v - full[i]));
    return wma(diff, Math.max(1, Math.floor(Math.sqrt(length))));
};

// ---------------------------------------------------------------------------
// Oscillators and statistics
// ---------------------------------------------------------------------------

/**
 * Pine `ta.stoch(sourceHigh, sourceLow, sourceClose, length)`: returns [k, d]
 * where `k` is the raw %K and `d` is `ta.sma(k, smoothK)`.
 */
export const stoch = (high: Series, low: Series, close: Series, length: number): [Series, Series] => {
    const raw: Series = [];
    for (let i = 0; i < close.length; i++) {
        let hh = -Infinity;
        let ll = Infinity;
        for (let j = Math.max(0, i - length + 1); j <= i; j++) {
            const h = high[j];
            const l = low[j];
            if (Number.isNaN(h) || Number.isNaN(l)) {
                hh = NA;
                ll = NA;
                break;
            }
            if (h > hh) hh = h;
            if (l < ll) ll = l;
        }
        if (Number.isNaN(hh) || Number.isNaN(ll) || hh === ll) {
            raw.push(NA);
            continue;
        }
        raw.push((100 * (close[i] - ll)) / (hh - ll));
    }
    return [raw, sma(raw, 3)];
};

/** Pine `ta.rsi(source, length)`. */
export const rsi = (source: Series, length: number): Series => {
    const change = source.map((v, i) => (i === 0 || Number.isNaN(v) || Number.isNaN(source[i - 1]) ? NA : v - source[i - 1]));
    const up = change.map((v) => (Number.isNaN(v) ? NA : Math.max(v, 0)));
    const down = change.map((v) => (Number.isNaN(v) ? NA : -Math.min(v, 0)));
    const avgUp = rma(up, length);
    const avgDown = rma(down, length);
    return avgUp.map((u, i) => {
        const d = avgDown[i];
        if (Number.isNaN(u) || Number.isNaN(d)) return NA;
        if (d === 0) return 100;
        if (u === 0) return 0;
        const rs = u / d;
        return 100 - 100 / (1 + rs);
    });
};

/** Pine `ta.macd(source, fast, slow, signal)`: returns [macd, signal, histogram]. */
export const macd = (source: Series, fast: number, slow: number, signal: number): [Series, Series, Series] => {
    const fastEma = ema(source, fast);
    const slowEma = ema(source, slow);
    const line = fastEma.map((v, i) => (Number.isNaN(v) || Number.isNaN(slowEma[i]) ? NA : v - slowEma[i]));
    const signalLine = ema(line, signal);
    const hist = line.map((v, i) => (Number.isNaN(v) || Number.isNaN(signalLine[i]) ? NA : v - signalLine[i]));
    return [line, signalLine, hist];
};

/** Pine `ta.bb(source, length, mult)`: returns [basis, upper, lower]. */
export const bb = (source: Series, length: number, mult: number): [Series, Series, Series] => {
    const basis = sma(source, length);
    const upper: Series = [];
    const lower: Series = [];
    for (let i = 0; i < source.length; i++) {
        if (Number.isNaN(basis[i])) {
            upper.push(NA);
            lower.push(NA);
            continue;
        }
        let sum = 0;
        for (let j = Math.max(0, i - length + 1); j <= i; j++) {
            const d = source[j] - basis[i];
            sum += d * d;
        }
        const dev = Math.sqrt(sum / length);
        upper.push(basis[i] + mult * dev);
        lower.push(basis[i] - mult * dev);
    }
    return [basis, upper, lower];
};

/** Pine `ta.stdev(source, length)`. */
export const stdev = (source: Series, length: number): Series => {
    const basis = sma(source, length);
    return basis.map((b, i) => {
        if (Number.isNaN(b)) return NA;
        let sum = 0;
        for (let j = Math.max(0, i - length + 1); j <= i; j++) {
            const d = source[j] - b;
            sum += d * d;
        }
        return Math.sqrt(sum / length);
    });
};

/** Pine `ta.tr(true)`: true range, using the previous close. */
export const trueRange = (high: Series, low: Series, close: Series): Series =>
    close.map((_, i) => {
        if (i === 0 || Number.isNaN(high[i]) || Number.isNaN(low[i]) || Number.isNaN(close[i - 1])) return NA;
        const prevClose = close[i - 1];
        return Math.max(high[i] - low[i], Math.abs(high[i] - prevClose), Math.abs(low[i] - prevClose));
    });

/** Pine `ta.atr(length)`. */
export const atr = (high: Series, low: Series, close: Series, length: number): Series =>
    rma(trueRange(high, low, close), length);

/** Pine `ta.cci(source, length)`. */
export const cci = (source: Series, length: number): Series => {
    const basis = sma(source, length);
    const meanDev = basis.map((b, i) => {
        if (Number.isNaN(b)) return NA;
        let sum = 0;
        for (let j = Math.max(0, i - length + 1); j <= i; j++) sum += Math.abs(source[j] - b);
        return sum / length;
    });
    return basis.map((b, i) => {
        const md = meanDev[i];
        if (Number.isNaN(b) || Number.isNaN(md) || md === 0) return NA;
        return (source[i] - b) / (0.015 * md);
    });
};

/** Pine `ta.mfi(hlc3, length)`: money flow index. */
export const mfi = (hlc3: Series, volume: Series, length: number): Series => {
    const raw = hlc3.map((v, i) => (i === 0 ? NA : v - hlc3[i - 1]));
    const pos = raw.map((v, i) => (Number.isNaN(v) ? NA : v > 0 ? volume[i] : 0));
    const neg = raw.map((v, i) => (Number.isNaN(v) ? NA : v < 0 ? volume[i] : 0));
    const posSum = sma(pos, length);
    const negSum = sma(neg, length);
    return posSum.map((p, i) => {
        const n = negSum[i];
        if (Number.isNaN(p) || Number.isNaN(n)) return NA;
        if (n === 0) return 100;
        return 100 - 100 / (1 + p / n);
    });
};

/** Pine `ta.vwap(source)`: session-anchored VWAP (resets on every new series). */
export const vwap = (source: Series, volume: Series): Series => {
    let cumPv = 0;
    let cumVol = 0;
    return source.map((v, i) => {
        if (Number.isNaN(v)) return NA;
        const vol = nz(volume[i]);
        cumPv += v * vol;
        cumVol += vol;
        return cumVol === 0 ? NA : cumPv / cumVol;
    });
};

// ---------------------------------------------------------------------------
// Rolling windows and helpers
// ---------------------------------------------------------------------------

/** Pine `ta.highest(source, length)`. */
export const highest = (source: Series, length: number): Series => {
    const out = blank(source);
    for (let i = 0; i < source.length; i++) {
        let h = -Infinity;
        let ok = true;
        for (let j = Math.max(0, i - length + 1); j <= i; j++) {
            const v = source[j];
            if (Number.isNaN(v)) {
                ok = false;
                break;
            }
            if (v > h) h = v;
        }
        if (ok) out[i] = h;
    }
    return out;
};

/** Pine `ta.lowest(source, length)`. */
export const lowest = (source: Series, length: number): Series => {
    const out = blank(source);
    for (let i = 0; i < source.length; i++) {
        let l = Infinity;
        let ok = true;
        for (let j = Math.max(0, i - length + 1); j <= i; j++) {
            const v = source[j];
            if (Number.isNaN(v)) {
                ok = false;
                break;
            }
            if (v < l) l = v;
        }
        if (ok) out[i] = l;
    }
    return out;
};

/** Pine `ta.change(source, length)`. */
export const change = (source: Series, length = 1): Series =>
    source.map((v, i) => (i < length || Number.isNaN(v) || Number.isNaN(source[i - length]) ? NA : v - source[i - length]));

/** Pine `ta.mom(source, length)`. */
export const mom = (source: Series, length: number): Series => change(source, length);

/** Pine `ta.tr` percent change, `ta.roc(source, length)`. */
export const roc = (source: Series, length: number): Series =>
    source.map((v, i) => {
        if (i < length || Number.isNaN(v) || Number.isNaN(source[i - length]) || source[i - length] === 0) return NA;
        return ((v - source[i - length]) / source[i - length]) * 100;
    });

/** Pine `ta.crossover(a, b)`: true on the bar where `a` crosses above `b`. */
export const crossover = (a: Series, b: Series): boolean[] =>
    a.map((v, i) => {
        if (i === 0) return false;
        const pa = a[i - 1];
        const pb = b[i - 1];
        if (Number.isNaN(v) || Number.isNaN(b[i]) || Number.isNaN(pa) || Number.isNaN(pb)) return false;
        return pa <= pb && v > b[i];
    });

/** Pine `ta.crossunder(a, b)`: true on the bar where `a` crosses below `b`. */
export const crossunder = (a: Series, b: Series): boolean[] =>
    a.map((v, i) => {
        if (i === 0) return false;
        const pa = a[i - 1];
        const pb = b[i - 1];
        if (Number.isNaN(v) || Number.isNaN(b[i]) || Number.isNaN(pa) || Number.isNaN(pb)) return false;
        return pa >= pb && v < b[i];
    });

// ---------------------------------------------------------------------------
// Price transforms
// ---------------------------------------------------------------------------

export const hl2 = (high: Series, low: Series): Series => high.map((h, i) => (Number.isNaN(h) || Number.isNaN(low[i]) ? NA : (h + low[i]) / 2));
export const hlc3 = (high: Series, low: Series, close: Series): Series =>
    close.map((_, i) => (Number.isNaN(high[i]) || Number.isNaN(low[i]) || Number.isNaN(close[i]) ? NA : (high[i] + low[i] + close[i]) / 3));
export const ohlc4 = (open: Series, high: Series, low: Series, close: Series): Series =>
    close.map((_, i) => (Number.isNaN(open[i]) || Number.isNaN(high[i]) || Number.isNaN(low[i]) || Number.isNaN(close[i]) ? NA : (open[i] + high[i] + low[i] + close[i]) / 4));

/** Pine `math.sum(source, length)` — rolling sum. */
export const sum = (source: Series, length: number): Series => {
    const out = blank(source);
    for (let i = 0; i < source.length; i++) {
        let s = 0;
        let ok = true;
        for (let j = Math.max(0, i - length + 1); j <= i; j++) {
            const v = source[j];
            if (Number.isNaN(v)) {
                ok = false;
                break;
            }
            s += v;
        }
        if (ok) out[i] = s;
    }
    return out;
};
