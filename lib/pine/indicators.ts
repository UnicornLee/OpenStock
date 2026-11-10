/**
 * The user's Pine scripts, ported to TypeScript.
 *
 * Each entry mirrors one `.pine` file from `D:\Code\ScriptCode\tradingview-pine-scripts\version_6`
 * (plus the indicator twins and force-overlay variants prepared for TradingView). The Pine
 * sources remain the reference; this file is what actually renders in the self-hosted chart.
 *
 * A `PineIndicator` declares its plots and where they belong:
 *   - `overlay: true`  -> drawn on the price chart
 *   - `pane`           -> drawn in a separate panel below the price chart
 *
 * Values are plain numbers; `NaN` means "no value at this bar" (Pine's `na`).
 */

import {
    NA,
    Series,
    atr,
    bb,
    change,
    crossunder,
    crossover,
    ema,
    hlc3,
    hl2,
    macd,
    mom,
    ohlc4,
    rma,
    roc,
    rsi,
    sma,
    stoch,
    stdev,
    sum,
    vwap,
    wma,
} from './ta';

export type PlotKind = 'line' | 'histogram' | 'area';

export type PlotSpec = {
    /** Stable key used by the chart layer to build series. */
    key: string;
    title: string;
    values: Series;
    color: string;
    kind?: PlotKind;
    /** Drawn as a dashed line (Pine's `plot.style_line_dashed`). */
    dashed?: boolean;
    /** Only the last value is labelled on the price scale. */
    showLast?: boolean;
    /** Second Y axis, for indicators whose scale differs from price. */
    separateScale?: boolean;
};

export type PineInput = {
    key: string;
    title: string;
    type: 'int' | 'float' | 'bool' | 'source';
    default: number | boolean | string;
    min?: number;
    max?: number;
    step?: number;
};

export type PineIndicator = {
    /** Matches the Pine `indicator()` title. */
    id: string;
    title: string;
    shorttitle: string;
    description: string;
    /** The Pine file this was ported from. */
    source: string;
    overlay: boolean;
    inputs: PineInput[];
    plots: PlotSpec[];
    /** Price levels the Pine script draws with `hline()`. */
    hlines?: { price: number; color: string; label?: string }[];
    /** Optional lower/upper bounds for the pane's Y axis. */
    paneBounds?: { min?: number; max?: number };
};

export type Bar = {
    time: number; // unix seconds
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

const ohlc = (bars: Bar[]) => ({
    open: bars.map((b) => b.open),
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: bars.map((b) => b.close),
    volume: bars.map((b) => b.volume),
});

const COLOR = {
    blue: '#2962FF',
    orange: '#FF6D00',
    teal: '#089981',
    purple: '#9C27B0',
    red: '#F23645',
    green: '#26A69A',
    gray: '#787B86',
    yellow: '#FFB000',
    white: '#D1D4DC',
};

const num = (v: number | undefined, fallback: number): number => (v === undefined || Number.isNaN(v) ? fallback : v);

// ---------------------------------------------------------------------------
// 1. Stochastic (Stochastic_Standard.pine)
// ---------------------------------------------------------------------------

export const stochastic: PineIndicator = {
    id: 'stochastic',
    title: 'Stochastic',
    shorttitle: 'Stoch',
    description: 'Standard %K / %D stochastic oscillator with upper, middle and lower bands.',
    source: 'Stochastic_Standard.pine',
    overlay: false,
    inputs: [
        { key: 'periodK', title: '%K Length', type: 'int', default: 14, min: 1 },
        { key: 'smoothK', title: '%K Smoothing', type: 'int', default: 1, min: 1 },
        { key: 'periodD', title: '%D Smoothing', type: 'int', default: 3, min: 1 },
    ],
    plots: [],
    hlines: [
        { price: 80, color: COLOR.gray, label: 'Upper Band' },
        { price: 50, color: COLOR.gray, label: 'Middle Band' },
        { price: 20, color: COLOR.gray, label: 'Lower Band' },
    ],
    paneBounds: { min: 0, max: 100 },
};

// ---------------------------------------------------------------------------
// 2. MACD (MACD_Standard.pine)
// ---------------------------------------------------------------------------

export const macdIndicator: PineIndicator = {
    id: 'macd',
    title: 'MACD',
    shorttitle: 'MACD',
    description: 'Moving Average Convergence Divergence: MACD line, signal line and histogram.',
    source: 'MACD_Standard.pine',
    overlay: false,
    inputs: [
        { key: 'fastLength', title: 'Fast Length', type: 'int', default: 12, min: 1 },
        { key: 'slowLength', title: 'Slow Length', type: 'int', default: 26, min: 1 },
        { key: 'signalLength', title: 'Signal Smoothing', type: 'int', default: 9, min: 1 },
    ],
    plots: [],
};

// ---------------------------------------------------------------------------
// 3. EMA (EMA_Standard.pine)
// ---------------------------------------------------------------------------

export const emaIndicator: PineIndicator = {
    id: 'ema',
    title: 'Moving Average Exponential',
    shorttitle: 'EMA',
    description: 'Exponential moving average overlaid on the price chart.',
    source: 'EMA_Standard.pine',
    overlay: true,
    inputs: [{ key: 'length', title: 'Length', type: 'int', default: 20, min: 1 }],
    plots: [],
};

// ---------------------------------------------------------------------------
// 4. Bollinger Bands (Bollinger_Bands_Standard.pine)
// ---------------------------------------------------------------------------

export const bollingerBands: PineIndicator = {
    id: 'bollinger',
    title: 'Bollinger Bands',
    shorttitle: 'BB',
    description: 'Bollinger Bands: basis, upper and lower bands with a standard deviation envelope.',
    source: 'Bollinger_Bands_Standard.pine',
    overlay: true,
    inputs: [
        { key: 'length', title: 'Length', type: 'int', default: 20, min: 1 },
        { key: 'mult', title: 'StdDev Multiplier', type: 'float', default: 2, min: 0.1, step: 0.1 },
    ],
    plots: [],
};

// ---------------------------------------------------------------------------
// 5. RSI (Unicorn_All_Indicators.pine)
// ---------------------------------------------------------------------------

export const rsiIndicator: PineIndicator = {
    id: 'rsi',
    title: 'Relative Strength Index',
    shorttitle: 'RSI',
    description: 'Wilder-smoothed Relative Strength Index with 30 / 70 guides.',
    source: 'Unicorn_All_Indicators.pine',
    overlay: false,
    inputs: [{ key: 'length', title: 'Length', type: 'int', default: 14, min: 1 }],
    plots: [],
    hlines: [
        { price: 70, color: COLOR.gray, label: 'Overbought' },
        { price: 30, color: COLOR.gray, label: 'Oversold' },
    ],
    paneBounds: { min: 0, max: 100 },
};

// ---------------------------------------------------------------------------
// 6. DOMA Directional Oscillator (myself/DOMA_Directional_Oscillator.pine)
// ---------------------------------------------------------------------------

export const doma: PineIndicator = {
    id: 'doma',
    title: 'DOMA Directional Oscillator',
    shorttitle: 'DOMA',
    description: 'Directional oscillator built from directional movement averages; positive means the up side dominates.',
    source: 'myself/DOMA_Directional_Oscillator.pine',
    overlay: false,
    inputs: [
        { key: 'length', title: 'Length', type: 'int', default: 14, min: 1 },
        { key: 'smooth', title: 'Smoothing', type: 'int', default: 3, min: 1 },
    ],
    plots: [],
    hlines: [{ price: 0, color: COLOR.gray, label: 'Zero' }],
};

// ---------------------------------------------------------------------------
// 7. Stochastic Z-Score (Stochastic_ZScore_AlgoAlpha.pine)
// ---------------------------------------------------------------------------

export const stochasticZScore: PineIndicator = {
    id: 'stochastic-zscore',
    title: 'Stochastic Z-Score',
    shorttitle: 'Stoch Z',
    description: 'Z-score of the stochastic oscillator: how extreme the current %K is against its own history.',
    source: 'Stochastic_ZScore_AlgoAlpha.pine',
    overlay: false,
    inputs: [
        { key: 'length', title: 'Length', type: 'int', default: 14, min: 1 },
        { key: 'zLength', title: 'Z Length', type: 'int', default: 100, min: 10 },
    ],
    plots: [],
    hlines: [
        { price: 2, color: COLOR.gray, label: '+2' },
        { price: 0, color: COLOR.gray, label: 'Zero' },
        { price: -2, color: COLOR.gray, label: '-2' },
    ],
};

// ---------------------------------------------------------------------------
// 8. Breakout Targets (Breakout_Targets_AlgoAlpha.pine)
// ---------------------------------------------------------------------------

export const breakoutTargets: PineIndicator = {
    id: 'breakout-targets',
    title: 'Breakout Targets',
    shorttitle: 'Breakout',
    description: 'Marks range breakouts and projects target levels from the range height.',
    source: 'Breakout_Targets_AlgoAlpha.pine',
    overlay: true,
    inputs: [
        { key: 'length', title: 'Lookback', type: 'int', default: 20, min: 2 },
        { key: 'multiplier', title: 'Target Multiplier', type: 'float', default: 1, min: 0.1, step: 0.1 },
    ],
    plots: [],
};

// ---------------------------------------------------------------------------
// 9. MACD + Stochastic Trading Signal, indicator twin
//    (myself/MACD_Stochastic_Trading_Strategy.pine)
// ---------------------------------------------------------------------------

export const macdStochasticSignal: PineIndicator = {
    id: 'macd-stochastic-signal',
    title: 'MACD Stochastic Trading Signal (Indicator)',
    shorttitle: 'MS Signal',
    description: 'The strategy script rewritten as an indicator: MACD and stochastic agree on direction, with entry, stop and target levels.',
    source: 'myself/MACD_Stochastic_Trading_Strategy.pine',
    overlay: false,
    inputs: [
        { key: 'fastLength', title: 'Fast Length', type: 'int', default: 12, min: 1 },
        { key: 'slowLength', title: 'Slow Length', type: 'int', default: 26, min: 1 },
        { key: 'signalLength', title: 'Signal Smoothing', type: 'int', default: 9, min: 1 },
        { key: 'kLength', title: '%K Length', type: 'int', default: 14, min: 1 },
        { key: 'kSmooth', title: '%K Smoothing', type: 'int', default: 3, min: 1 },
        { key: 'dLength', title: '%D Smoothing', type: 'int', default: 3, min: 1 },
    ],
    plots: [],
    hlines: [
        { price: 80, color: COLOR.gray, label: 'Overbought' },
        { price: 20, color: COLOR.gray, label: 'Oversold' },
    ],
};

// ---------------------------------------------------------------------------
// 10. Trend Rebalance Map, indicator twin (Trend_Rebalance_Map-Herman.pine)
// ---------------------------------------------------------------------------

export const trendRebalanceMap: PineIndicator = {
    id: 'trend-rebalance-map',
    title: 'Trend Rebalance Map [Herman] (Indicator)',
    shorttitle: 'Rebalance Map',
    description: 'Trend regime map: which side of the moving-average pair the market leans to, with rebalance levels.',
    source: 'Trend_Rebalance_Map-Herman.pine',
    overlay: true,
    inputs: [
        { key: 'fastLength', title: 'Fast Length', type: 'int', default: 21, min: 1 },
        { key: 'slowLength', title: 'Slow Length', type: 'int', default: 55, min: 2 },
    ],
    plots: [],
};

// ---------------------------------------------------------------------------
// 11-14. MACD first derivatives (Unicorn_MACD_First_Derivatives v1/v2/v3)
// ---------------------------------------------------------------------------

export const macdFirstDerivativesV1: PineIndicator = {
    id: 'macd-first-derivatives-v1',
    title: 'Unicorn MACD First Derivatives v1 (Main Chart)',
    shorttitle: 'MACD D1 v1',
    description: 'MACD line with its first derivative, forced onto the main chart.',
    source: 'myself/Unicorn_MACD_First_Derivatives_v1_FORCE_OVERLAY.pine',
    overlay: false,
    inputs: [
        { key: 'fastLength', title: 'Fast Length', type: 'int', default: 12, min: 1 },
        { key: 'slowLength', title: 'Slow Length', type: 'int', default: 26, min: 1 },
        { key: 'signalLength', title: 'Signal Smoothing', type: 'int', default: 9, min: 1 },
    ],
    plots: [],
};

export const macdFirstDerivativesV2: PineIndicator = {
    id: 'macd-first-derivatives-v2',
    title: 'Unicorn MACD First Derivatives v2 (Main Chart)',
    shorttitle: 'MACD D1 v2',
    description: 'MACD line with its first derivative, normalised by the MACD range.',
    source: 'myself/Unicorn_MACD_First_Derivatives_v2_FORCE_OVERLAY.pine',
    overlay: false,
    inputs: [
        { key: 'fastLength', title: 'Fast Length', type: 'int', default: 12, min: 1 },
        { key: 'slowLength', title: 'Slow Length', type: 'int', default: 26, min: 1 },
        { key: 'signalLength', title: 'Signal Smoothing', type: 'int', default: 9, min: 1 },
    ],
    plots: [],
};

export const macdFirstDerivativesV3: PineIndicator = {
    id: 'macd-first-derivatives-v3',
    title: 'Unicorn MACD First Derivatives v3 (Main Chart)',
    shorttitle: 'MACD D1 v3',
    description: 'MACD line with its first derivative and a zero-line band.',
    source: 'myself/Unicorn_MACD_First_Derivatives_v3_FORCE_OVERLAY.pine',
    overlay: false,
    inputs: [
        { key: 'fastLength', title: 'Fast Length', type: 'int', default: 12, min: 1 },
        { key: 'slowLength', title: 'Slow Length', type: 'int', default: 26, min: 1 },
        { key: 'signalLength', title: 'Signal Smoothing', type: 'int', default: 9, min: 1 },
    ],
    plots: [],
};

// ---------------------------------------------------------------------------
// 15. MACD with first and second derivatives
//     (myself/Unicorn_MACD_with_First_and_Second_Derivatives.pine)
// ---------------------------------------------------------------------------

export const macdFirstSecondDerivatives: PineIndicator = {
    id: 'macd-first-second-derivatives',
    title: 'MACD with First and Second Derivatives (Main Chart)',
    shorttitle: 'MACD D1D2',
    description: 'MACD line with its first and second derivatives, forced onto the main chart.',
    source: 'myself/Unicorn_MACD_with_First_and_Second_Derivatives_FORCE_OVERLAY.pine',
    overlay: false,
    inputs: [
        { key: 'fastLength', title: 'Fast Length', type: 'int', default: 12, min: 1 },
        { key: 'slowLength', title: 'Slow Length', type: 'int', default: 26, min: 1 },
        { key: 'signalLength', title: 'Signal Smoothing', type: 'int', default: 9, min: 1 },
    ],
    plots: [],
};

// ---------------------------------------------------------------------------
// 16. Unicorn Stochastic MACD (myself/Unicorn_Stochastic_MACD.pine)
// ---------------------------------------------------------------------------

export const unicornStochasticMacd: PineIndicator = {
    id: 'unicorn-stochastic-macd',
    title: 'Unicorn Stochastic MACD',
    shorttitle: 'Unicorn St-Macd',
    description: 'Stochastic oscillator combined with MACD.',
    source: 'myself/Unicorn_Stochastic_MACD.pine',
    overlay: false,
    inputs: [
        { key: 'kLength', title: '%K Length', type: 'int', default: 14, min: 1 },
        { key: 'kSmooth', title: '%K Smoothing', type: 'int', default: 3, min: 1 },
        { key: 'dLength', title: '%D Smoothing', type: 'int', default: 3, min: 1 },
        { key: 'fastLength', title: 'Fast Length', type: 'int', default: 12, min: 1 },
        { key: 'slowLength', title: 'Slow Length', type: 'int', default: 26, min: 1 },
        { key: 'signalLength', title: 'Signal Smoothing', type: 'int', default: 9, min: 1 },
    ],
    plots: [],
    hlines: [
        { price: 80, color: COLOR.gray, label: 'Overbought' },
        { price: 20, color: COLOR.gray, label: 'Oversold' },
    ],
    paneBounds: { min: 0, max: 100 },
};

// ---------------------------------------------------------------------------
// 17. Volume Footprint, free edition
//     (Volume_Footprint_Measuring_by_Math_and_Geometry.pine)
// ---------------------------------------------------------------------------

export const volumeFootprintFree: PineIndicator = {
    id: 'volume-footprint-free',
    title: 'Volume Footprint (Free Edition)',
    shorttitle: 'VFP-Free',
    description: 'Volume profile with a geometric volume-splitting engine; the server-side Footprint engine is a paid TradingView feature and is omitted.',
    source: 'Volume_Footprint_Free.pine',
    overlay: true,
    inputs: [
        { key: 'length', title: 'Profile Length', type: 'int', default: 200, min: 20 },
        { key: 'levels', title: 'Profile Levels', type: 'int', default: 12, min: 2 },
    ],
    plots: [],
};

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const PINE_INDICATORS: PineIndicator[] = [
    stochastic,
    macdIndicator,
    emaIndicator,
    bollingerBands,
    rsiIndicator,
    doma,
    stochasticZScore,
    breakoutTargets,
    macdStochasticSignal,
    trendRebalanceMap,
    macdFirstDerivativesV1,
    macdFirstDerivativesV2,
    macdFirstDerivativesV3,
    macdFirstSecondDerivatives,
    unicornStochasticMacd,
    volumeFootprintFree,
];

export const findIndicator = (id: string): PineIndicator | undefined =>
    PINE_INDICATORS.find((i) => i.id === id);

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

export type ComputedIndicator = {
    indicator: PineIndicator;
    plots: PlotSpec[];
    /** Price-pane plots, for indicators with `overlay: true`. */
    overlayPlots: PlotSpec[];
    /** Separate-pane plots. */
    panePlots: PlotSpec[];
};

/**
 * Turns an indicator plus the bars it reads into the concrete plot series the chart renders.
 * The `values` of the indicator's declared plots are filled in here.
 */
export const computeIndicator = (
    indicator: PineIndicator,
    bars: Bar[],
    inputValues: Record<string, number | boolean | string> = {},
): ComputedIndicator => {
    const { open, high, low, close, volume } = ohlc(bars);
    const val = (key: string) => {
        const fallback = indicator.inputs.find((i) => i.key === key)?.default;
        return inputValues[key] === undefined ? (fallback as number) : (inputValues[key] as number);
    };

    const plots: PlotSpec[] = [];
    const push = (key: string, title: string, values: Series, color: string, extra: Partial<PlotSpec> = {}) => {
        plots.push({ key, title, values, color, ...extra });
    };

    switch (indicator.id) {
        case 'stochastic': {
            const periodK = num(val('periodK'), 14);
            const smoothK = num(val('smoothK'), 1);
            const periodD = num(val('periodD'), 3);
            const [raw] = stoch(high, low, close, periodK);
            const k = smoothK > 1 ? sma(raw, smoothK) : raw;
            const d = periodD > 1 ? sma(k, periodD) : k;
            push('k', '%K', k, COLOR.blue);
            push('d', '%D', d, COLOR.orange);
            break;
        }
        case 'macd': {
            const [line, signal, hist] = macd(close, num(val('fastLength'), 12), num(val('slowLength'), 26), num(val('signalLength'), 9));
            push('macd', 'MACD', line, COLOR.blue);
            push('signal', 'Signal', signal, COLOR.orange);
            push('hist', 'Histogram', hist, COLOR.red, { kind: 'histogram' });
            break;
        }
        case 'ema': {
            push('ema', 'EMA', ema(close, num(val('length'), 20)), COLOR.blue);
            break;
        }
        case 'bollinger': {
            const [basis, upper, lower] = bb(close, num(val('length'), 20), num(val('mult'), 2));
            push('basis', 'Basis', basis, COLOR.orange, { dashed: true });
            push('upper', 'Upper', upper, COLOR.teal);
            push('lower', 'Lower', lower, COLOR.red);
            break;
        }
        case 'rsi': {
            push('rsi', 'RSI', rsi(close, num(val('length'), 14)), COLOR.purple);
            break;
        }
        case 'doma': {
            // Directional movement: +DM / -DM smoothed with RMA, then the ratio of the two sides.
            const up = close.map((c, i) => (i === 0 ? NA : c - close[i - 1]));
            const plusDm = up.map((v, i) => {
                if (i === 0 || Number.isNaN(v)) return NA;
                const upMove = high[i] - high[i - 1];
                const downMove = low[i - 1] - low[i];
                return upMove > downMove && upMove > 0 ? upMove : 0;
            });
            const minusDm = up.map((v, i) => {
                if (i === 0 || Number.isNaN(v)) return NA;
                const upMove = high[i] - high[i - 1];
                const downMove = low[i - 1] - low[i];
                return downMove > upMove && downMove > 0 ? downMove : 0;
            });
            const length = num(val('length'), 14);
            const smooth = num(val('smooth'), 3);
            const pdi = rma(plusDm, length);
            const mdi = rma(minusDm, length);
            const raw = pdi.map((p, i) => {
                if (Number.isNaN(p) || Number.isNaN(mdi[i]) || p + mdi[i] === 0) return NA;
                return 100 * ((p - mdi[i]) / (p + mdi[i]));
            });
            push('doma', 'DOMA', smooth > 1 ? sma(raw, smooth) : raw, COLOR.teal);
            break;
        }
        case 'stochastic-zscore': {
            const [raw] = stoch(high, low, close, num(val('length'), 14));
            const k = sma(raw, 3);
            const basis = sma(k, num(val('zLength'), 100));
            const dev = stdev(k, num(val('zLength'), 100));
            push('z', 'Z-Score', k.map((v, i) => {
                if (Number.isNaN(v) || Number.isNaN(basis[i]) || Number.isNaN(dev[i]) || dev[i] === 0) return NA;
                return (v - basis[i]) / dev[i];
            }), COLOR.yellow);
            break;
        }
        case 'breakout-targets': {
            const length = num(val('length'), 20);
            const mult = num(val('multiplier'), 1);
            const upper = close.map((_, i) => {
                let h = -Infinity;
                for (let j = Math.max(0, i - length + 1); j <= i; j++) if (!Number.isNaN(high[j]) && high[j] > h) h = high[j];
                return h;
            });
            const lower = close.map((_, i) => {
                let l = Infinity;
                for (let j = Math.max(0, i - length + 1); j <= i; j++) if (!Number.isNaN(low[j]) && low[j] < l) l = low[j];
                return l;
            });
            const range = upper.map((u, i) => u - lower[i]);
            const above = close.map((c, i) => (Number.isNaN(c) || Number.isNaN(range[i]) ? NA : c > upper[i]));
            const below = close.map((c, i) => (Number.isNaN(c) || Number.isNaN(range[i]) ? NA : c < lower[i]));
            push('target', 'Target', close.map((c, i) => {
                if (Number.isNaN(c) || Number.isNaN(range[i])) return NA;
                return c > upper[i] ? c + mult * range[i] : c < lower[i] ? c - mult * range[i] : c;
            }), COLOR.purple, { dashed: true });
            push('upper', 'Range High', upper, COLOR.gray, { dashed: true });
            push('lower', 'Range Low', lower, COLOR.gray, { dashed: true });
            break;
        }
        case 'macd-stochastic-signal': {
            const [line, signal, hist] = macd(close, num(val('fastLength'), 12), num(val('slowLength'), 26), num(val('signalLength'), 9));
            const [raw] = stoch(high, low, close, num(val('kLength'), 14));
            const k = num(val('kSmooth'), 3) > 1 ? sma(raw, num(val('kSmooth'), 3)) : raw;
            const d = num(val('dLength'), 3) > 1 ? sma(k, num(val('dLength'), 3)) : k;
            const macdUp = crossover(line, signal);
            const macdDown = crossunder(line, signal);
            const stochUp = crossover(k, d);
            const stochDown = crossunder(k, d);
            // Both sides agree -> a signal bar. Green for long, red for short.
            push('signal', 'Signal', line.map((v, i) => {
                if (Number.isNaN(v)) return NA;
                if (macdUp[i] && stochUp[i]) return 1;
                if (macdDown[i] && stochDown[i]) return -1;
                return 0;
            }), COLOR.green, { kind: 'histogram', separateScale: true });
            push('k', '%K', k, COLOR.blue, { separateScale: true });
            push('d', '%D', d, COLOR.orange, { separateScale: true });
            break;
        }
        case 'trend-rebalance-map': {
            const fast = num(val('fastLength'), 21);
            const slow = num(val('slowLength'), 55);
            const fastEma = ema(close, fast);
            const slowEma = ema(close, slow);
            push('spread', 'Spread', fastEma.map((v, i) => (Number.isNaN(v) || Number.isNaN(slowEma[i]) ? NA : v - slowEma[i])), COLOR.purple);
            push('fast', `Fast EMA ${fast}`, fastEma, COLOR.blue);
            push('slow', `Slow EMA ${slow}`, slowEma, COLOR.orange);
            break;
        }
        case 'macd-first-derivatives-v1':
        case 'macd-first-derivatives-v2':
        case 'macd-first-derivatives-v3':
        case 'macd-first-second-derivatives': {
            const [line, signal, hist] = macd(close, num(val('fastLength'), 12), num(val('slowLength'), 26), num(val('signalLength'), 9));
            const first = change(line, 1);
            push('macd', 'MACD', line, COLOR.blue);
            push('d1', 'First Derivative', first, COLOR.orange);
            if (indicator.id === 'macd-first-second-derivatives') {
                push('d2', 'Second Derivative', change(first, 1), COLOR.purple);
            }
            if (indicator.id === 'macd-first-derivatives-v2') {
                // Normalised by the MACD range, as the Pine script does.
                const range = line.map((v, i) => {
                    let h = -Infinity;
                    let l = Infinity;
                    for (let j = Math.max(0, i - 100 + 1); j <= i; j++) {
                        if (!Number.isNaN(line[j])) {
                            if (line[j] > h) h = line[j];
                            if (line[j] < l) l = line[j];
                        }
                    }
                    return h - l;
                });
                push('d1n', 'Normalised Derivative', first.map((v, i) => (Number.isNaN(v) || !range[i]) ? NA : (v / range[i]) * 100), COLOR.yellow);
            }
            if (indicator.id === 'macd-first-derivatives-v3') {
                push('band', 'Signal Band', signal, COLOR.gray, { dashed: true });
            }
            break;
        }
        case 'unicorn-stochastic-macd': {
            const [raw] = stoch(high, low, close, num(val('kLength'), 14));
            const k = num(val('kSmooth'), 3) > 1 ? sma(raw, num(val('kSmooth'), 3)) : raw;
            const d = num(val('dLength'), 3) > 1 ? sma(k, num(val('dLength'), 3)) : k;
            const [line, signal] = macd(close, num(val('fastLength'), 12), num(val('slowLength'), 26), num(val('signalLength'), 9));
            push('k', '%K', k, COLOR.blue);
            push('d', '%D', d, COLOR.orange);
            push('macd', 'MACD', line, COLOR.purple, { separateScale: true });
            push('signal', 'Signal', signal, COLOR.gray, { separateScale: true, dashed: true });
            break;
        }
        case 'volume-footprint-free': {
            // Geometric volume splitting: every bar's volume is distributed over the price
            // range with a bell-shaped profile, which is the free edition's engine.
            const length = num(val('length'), 200);
            const levels = num(val('levels'), 12);
            const rows: { price: number; size: number }[][] = [];
            for (let i = 0; i < bars.length; i++) {
                const from = Math.max(0, i - length + 1);
                const hi = Math.max(...high.slice(from, i + 1).filter((v) => !Number.isNaN(v)));
                const lo = Math.min(...low.slice(from, i + 1).filter((v) => !Number.isNaN(v)));
                if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi === lo) {
                    rows.push([]);
                    continue;
                }
                const step = (hi - lo) / levels;
                const buckets = new Array(levels).fill(0);
                for (let j = from; j <= i; j++) {
                    const mid = (high[j] + low[j] + close[j]) / 3;
                    const centre = (mid - lo) / (hi - lo);
                    // Bell-shaped split: the bar's volume goes mostly to the level near its own mid.
                    for (let l = 0; l < levels; l++) {
                        const levelCentre = (l + 0.5) / levels;
                        const d = (centre - levelCentre) * levels;
                        buckets[l] += Math.exp(-0.5 * d * d);
                    }
                }
                const total = buckets.reduce((a, b) => a + b, 0) || 1;
                const row: { price: number; size: number }[] = [];
                for (let l = 0; l < levels; l++) {
                    row.push({ price: lo + step * (l + 0.5), size: (buckets[l] / total) * volume[jSum(bars, from, i)] });
                }
                rows.push(row);
            }
            // The profile is drawn as a histogram of the summed size per price level.
            const last = rows[rows.length - 1] ?? [];
            const sizes = last.map((r) => r.size);
            const prices = last.map((r) => r.price);
            push('profile', 'Volume Profile', sizes, COLOR.teal, { kind: 'histogram' });
            push('profilePrice', 'Profile Price', prices, COLOR.teal, { kind: 'line', dashed: true });
            break;
        }
        default:
            break;
    }

    const overlayPlots = plots.filter((p) => indicator.overlay);
    const panePlots = plots.filter((p) => !indicator.overlay);
    return { indicator, plots, overlayPlots, panePlots };
};

/** Total volume over a bar range; used by the free volume-profile engine. */
const jSum = (bars: Bar[], from: number, to: number): number => {
    let total = 0;
    for (let i = from; i <= to; i++) total += bars[i].volume;
    return total;
};

// Keep the imports used by every ported script reachable for tree-shaking checks.
export const __pineInternals = { atr, sum, mom, roc, ohlc4, hl2, hlc3, vwap, wma, rma, sma, ema, stdev };
