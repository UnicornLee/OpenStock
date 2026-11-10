'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AreaSeries,
    CandlestickSeries,
    HistogramSeries,
    LineSeries,
    LineStyle,
    createChart,
    type IChartApi,
    type ISeriesApi,
    type SeriesDefinition,
    type SeriesPartialOptionsMap,
    type SeriesType,
    type UTCTimestamp,
} from 'lightweight-charts';
import { computeIndicator, findIndicator, type Bar, type PineIndicator } from '@/lib/pine/indicators';
import { formatLegend, resolveInputs } from '@/lib/pine/inputs';
import type { Interval } from '@/lib/gate';
import { cn } from '@/lib/utils';

/**
 * A self-hosted chart that draws the user's own Pine scripts.
 *
 * TradingView's embed cannot show a script the account is not allowed to publish, so the
 * indicators are computed locally from the same Pine logic (see `lib/pine/`) and painted
 * with lightweight-charts. Candles come from `/api/klines` (Gate.io).
 */

type Props = {
    symbol: string;
    interval?: Interval;
    /** Indicator ids to draw; overlay indicators join the price pane, the rest get their own pane. */
    indicatorIds?: string[];
    /** Per-indicator setting overrides, keyed by indicator id. */
    inputValues?: Record<string, Record<string, number | boolean | string>>;
    height?: number;
    className?: string;
    onError?: (message: string) => void;
};

const CHART_BG = '#1f1e1a';
const GRID = 'rgba(255, 255, 255, 0.04)';
const TEXT = '#a2a9b1';
const UP = '#26a69a';
const DOWN = '#ef5350';

const toUTCTime = (seconds: number) => seconds as UTCTimestamp;

export default function PineChart({
    symbol,
    interval = '5m',
    indicatorIds = [],
    inputValues = {},
    height = 560,
    className,
    onError,
}: Props) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const [bars, setBars] = useState<Bar[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const indicators = useMemo(
        () => indicatorIds.map((id) => findIndicator(id)).filter((i): i is PineIndicator => Boolean(i)),
        [indicatorIds],
    );

    // The effective settings of every drawn indicator: the user's overrides over the defaults.
    const effectiveInputs = useMemo(
        () =>
            Object.fromEntries(
                indicators.map((indicator) => [indicator.id, resolveInputs(indicator, inputValues[indicator.id])]),
            ),
        [indicators, inputValues],
    );

    // ---- candles -----------------------------------------------------------
    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        setLoading(true);
        setError(null);

        fetch(`/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=500`, {
            signal: controller.signal,
        })
            .then(async (res) => {
                if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
                return res.json();
            })
            .then((data) => {
                if (cancelled) return;
                setBars(data.candles ?? []);
                setLoading(false);
            })
            .catch((err) => {
                if (cancelled || err?.name === 'AbortError') return;
                const message = err?.message ?? 'failed to load candles';
                setError(message);
                setLoading(false);
                onError?.(message);
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [symbol, interval, onError]);

    // ---- chart -------------------------------------------------------------
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const chart = createChart(container, {
            autoSize: true,
            layout: {
                background: { color: CHART_BG },
                textColor: TEXT,
                fontSize: 11,
                panes: { separatorColor: GRID, separatorHoverColor: 'rgba(255,255,255,0.12)' },
            },
            grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
            crosshair: { mode: 0 },
            rightPriceScale: { borderColor: GRID, scaleMargins: { top: 0.12, bottom: 0.12 } },
            timeScale: { borderColor: GRID, timeVisible: true, secondsVisible: false },
            localization: { locale: 'zh-CN' },
        });
        chartRef.current = chart;

        const observer = new ResizeObserver(() => {
            chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
        });
        observer.observe(container);
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });

        return () => {
            observer.disconnect();
            chart.remove();
            chartRef.current = null;
        };
    }, []);

    // ---- series ------------------------------------------------------------
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || bars.length === 0) return;

        // Every series is tracked here, because lightweight-charts v5 has no `chart.series()`
        // accessor: when the indicator selection changes the old series must be removed first.
        const created: ISeriesApi<SeriesType>[] = [];
        const add = <T extends SeriesType>(
            definition: SeriesDefinition<T>,
            options: SeriesPartialOptionsMap[T],
            paneIndex?: number,
        ) => {
            const series = chart.addSeries(definition, options, paneIndex);
            created.push(series as unknown as ISeriesApi<SeriesType>);
            return series;
        };

        const candles = add(CandlestickSeries, {
            upColor: UP,
            downColor: DOWN,
            borderUpColor: UP,
            borderDownColor: DOWN,
            wickUpColor: UP,
            wickDownColor: DOWN,
            priceLineVisible: true,
            lastValueVisible: true,
        });
        candles.setData(
            bars.map((b) => ({
                time: toUTCTime(b.time),
                open: b.open,
                high: b.high,
                low: b.low,
                close: b.close,
            })),
        );

        const volume = add(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
            color: 'rgba(120, 130, 140, 0.35)',
            priceLineVisible: false,
            lastValueVisible: false,
        });
        chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        volume.setData(
            bars.map((b) => ({
                time: toUTCTime(b.time),
                value: b.volume,
                color: b.close >= b.open ? 'rgba(38, 166, 154, 0.4)' : 'rgba(239, 83, 80, 0.4)',
            })),
        );

        // Each non-overlay indicator gets its own pane, so several oscillators can stack.
        let paneIndex = 0;
        for (const indicator of indicators) {
            const computed = computeIndicator(indicator, bars, effectiveInputs[indicator.id]);
            const pane = indicator.overlay ? 0 : ++paneIndex;

            for (const plot of computed.plots) {
                const data = plot.values
                    .map((value, i) => ({ time: toUTCTime(bars[i].time), value }))
                    .filter((point) => Number.isFinite(point.value));

                if (data.length === 0) continue;

                if (plot.kind === 'histogram') {
                    const series = add(
                        HistogramSeries,
                        {
                            color: plot.color,
                            priceLineVisible: false,
                            lastValueVisible: false,
                        },
                        pane,
                    );
                    series.setData(data);
                } else {
                    const series = add(
                        LineSeries,
                        {
                            color: plot.color,
                            lineWidth: 1,
                            lineStyle: plot.dashed ? LineStyle.Dashed : LineStyle.Solid,
                            crosshairMarkerVisible: false,
                            lastValueVisible: false,
                            priceLineVisible: false,
                        },
                        pane,
                    );
                    series.setData(data);
                }
            }

            // Horizontal levels from the Pine `hline()` calls.
            for (const line of indicator.hlines ?? []) {
                candles.createPriceLine({
                    price: line.price,
                    color: line.color,
                    lineWidth: 1,
                    lineStyle: LineStyle.Dotted,
                    axisLabelVisible: true,
                    title: line.label ?? '',
                });
            }
        }

        chart.timeScale().fitContent();

        return () => {
            for (const series of created) {
                try {
                    chart.removeSeries(series);
                } catch {
                    // The chart may already be gone when the component unmounts.
                }
            }
        };
    }, [bars, indicators, effectiveInputs]);

    // ---- legend ------------------------------------------------------------
    // Which indicator lives in which pane, and with which settings. The chart itself has no
    // room for labels, so the legend is drawn as an overlay above it.
    const legend = useMemo(() => {
        const rows: { pane: number; text: string; color: string }[] = [];
        let paneIndex = 0;
        for (const indicator of indicators) {
            const pane = indicator.overlay ? 0 : ++paneIndex;
            const values = effectiveInputs[indicator.id];
            const plot = indicator.plots[0];
            rows.push({
                pane,
                text: formatLegend(indicator, values),
                color: plot?.color ?? '#a2a9b1',
            });
        }
        return rows;
    }, [indicators, effectiveInputs]);

    // The panes are stacked vertically; several indicators can share one pane (the overlay ones
    // all share the price pane), so each legend row gets its own line inside its pane.
    const legendRows = useMemo(() => {
        const perPane = new Map<number, number>();
        return legend.map((row) => {
            const line = perPane.get(row.pane) ?? 0;
            perPane.set(row.pane, line + 1);
            return { ...row, line };
        });
    }, [legend]);

    // Where each pane starts, in pixels from the top of the chart. The chart grows and shrinks
    // with the window, so the offsets are re-measured whenever the panes are (re)built.
    const [paneOffsets, setPaneOffsets] = useState<number[]>([]);

    const measurePanes = useCallback(() => {
        const chart = chartRef.current;
        if (!chart) return;
        const offsets: number[] = [];
        let top = 0;
        for (const pane of chart.panes()) {
            offsets.push(top);
            top += pane.getHeight();
        }
        setPaneOffsets(offsets);
    }, []);

    // The legend needs the pane layout, so it is measured after the series are built.
    useEffect(() => {
        measurePanes();
    }, [measurePanes, bars, indicators]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const observer = new ResizeObserver(() => measurePanes());
        observer.observe(container);
        return () => observer.disconnect();
    }, [measurePanes]);

    return (
        <div className={cn('relative', className)} style={{ height }}>
            <div ref={containerRef} className="h-full w-full" />
            {legendRows.length > 0 && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                    {legendRows.map((row, index) => (
                        <div
                            key={`${row.pane}-${index}`}
                            className="mono flex items-center gap-1.5 text-[11px] leading-none"
                            style={{
                                position: 'absolute',
                                left: 8,
                                top: (paneOffsets[row.pane] ?? 0) + 6 + row.line * 14,
                            }}
                        >
                            <span
                                className="inline-block h-[8px] w-[8px] shrink-0 rounded-[2px]"
                                style={{ backgroundColor: row.color }}
                            />
                            <span style={{ color: TEXT }}>{row.text}</span>
                        </div>
                    ))}
                </div>
            )}
            {loading ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-faint">
                    加载 K 线…
                </div>
            ) : null}
            {error ? (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-red-400">
                    {error}
                </div>
            ) : null}
        </div>
    );
}
