'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Settings2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import TradingViewWidget from '@/components/TradingViewWidget';
import PineChart from '@/components/PineChart';
import { CANDLE_CHART_WIDGET_CONFIG } from '@/lib/constants';
import { PINE_INDICATORS, findIndicator } from '@/lib/pine/indicators';
import { formatLegend, resolveInputs, usePineInputs } from '@/lib/pine/inputs';
import { TV_INTERVALS, type Interval } from '@/lib/gate';
import { cn } from '@/lib/utils';
import { getMonitorConfig, saveMonitorConfig } from '@/lib/actions/monitor.actions';

// A monitoring wall: many charts at once, each with any number of indicators.
//
// Two rendering engines sit side by side:
//   - 'tv'   the TradingView embed. It only knows TradingView's own study ids.
//   - 'pine' a self-hosted chart. It computes the user's own Pine scripts locally from
//            Gate.io candles, so scripts that cannot be published on TradingView still work.
//
// Every chart carries **its own** indicator set and its own indicator settings: adding a
// stochastic to one symbol does not put it on the others, and tuning the stochastic on one
// symbol leaves the other charts' stochastic untouched.

const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js`;

// Every indicator the embed accepts: TradingView's own study ids.
const BUILT_IN = [
    { id: 'STD;SMA', label: 'SMA' },
    { id: 'STD;EMA', label: 'EMA' },
    { id: 'STD;Bollinger_Bands', label: 'Bollinger Bands' },
    { id: 'STD;VWAP', label: 'VWAP' },
    { id: 'STD;RSI', label: 'RSI' },
    { id: 'STD;MACD', label: 'MACD' },
    { id: 'STD;Stochastic', label: 'Stochastic' },
    { id: 'STD;Average_True_Range', label: 'ATR' },
] as const;

// A published indicator arrives as PUB;<user>/<script>. Kept per account now, mirrored in localStorage
// so a wall still renders if the save call is slow or the browser is briefly offline.
const PUBLISHED_KEY = 'openstock:monitor-published';
const CHARTS_KEY = 'openstock:monitor-charts';
const STUDIES_KEY = 'openstock:monitor-studies';
const PINE_KEY = 'openstock:monitor-pine';
const MODE_KEY = 'openstock:monitor-mode';
const INTERVAL_KEY = 'openstock:monitor-interval';

// A sensible default wall, so the page is useful before anything is configured.
const DEFAULT_CHARTS = [
    { symbol: 'BINANCE:BTCUSDT', name: 'Bitcoin' },
    { symbol: 'BINANCE:ETHUSDT', name: 'Ethereum' },
    { symbol: 'BINANCE:XAUTUSDT', name: 'Tether Gold' },
    { symbol: 'BINANCE:SOLUSDT', name: 'Solana' },
];

type Chart = {
    symbol: string;
    name: string;
    /** TradingView study ids on this chart. */
    studies: string[];
    /** Ids of the self-hosted Pine indicators on this chart. */
    pineStudies: string[];
};
type Published = { id: string; label: string };
type Engine = 'tv' | 'pine';

const SYMBOL_PATTERN = /^[A-Z0-9.:\-]{1,20}$/;
const PUBLISHED_PATTERN = /^PUB;[^\s/]{1,64}\/[^\s]{1,80}$/;

// Published ids are pasted in batches, so accept newline, comma or whitespace between them.
const splitPublished = (raw: string): string[] =>
    raw
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);

const readJson = <T,>(key: string, fallback: T): T => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
};

/** Old walls stored charts as `{symbol, name}` only; the per-chart lists are new. */
const normalizeCharts = (raw: unknown, fallback: Chart[]): Chart[] => {
    const list = Array.isArray(raw) ? (raw as Partial<Chart>[]) : [];
    const charts = list
        .filter((c): c is Partial<Chart> & { symbol: string } => Boolean(c) && typeof c.symbol === 'string')
        .map((c) => ({
            symbol: c.symbol,
            name: typeof c.name === 'string' ? c.name : c.symbol,
            studies: Array.isArray(c.studies) ? c.studies.filter((s): s is string => typeof s === 'string') : [],
            pineStudies: Array.isArray(c.pineStudies)
                ? c.pineStudies.filter((s): s is string => typeof s === 'string')
                : [],
        }));
    return charts.length ? charts : fallback;
};

const ChartCard = ({
    chart,
    published,
    onRemove,
    onRename,
    onTogglePine,
    onToggleStudy,
    onOpenSettings,
    pineInputs,
}: {
    chart: Chart;
    published: Published[];
    onRemove: () => void;
    onRename: (name: string) => void;
    onTogglePine: (id: string) => void;
    onToggleStudy: (id: string) => void;
    onOpenSettings: (id: string) => void;
    pineInputs: ReturnType<typeof usePineInputs>;
}) => {
    const t = useTranslations('Monitor');
    const [expanded, setExpanded] = useState(false);
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(chart.name);
    const [mode, setMode] = useState<Engine>('tv');
    const [interval, setInterval] = useState<Interval>('5m');

    const config = useMemo(
        () => ({ ...CANDLE_CHART_WIDGET_CONFIG(chart.symbol), studies: chart.studies }),
        [chart.symbol, chart.studies],
    );

    // The engine choice and the timeframe are wall-wide preferences, so they are kept in
    // localStorage and shared by every card.
    useEffect(() => {
        const savedMode = localStorage.getItem(MODE_KEY);
        if (savedMode === 'tv' || savedMode === 'pine') setMode(savedMode);
        const savedInterval = localStorage.getItem(INTERVAL_KEY);
        if (savedInterval && TV_INTERVALS.some((i) => i.id === savedInterval)) setInterval(savedInterval as Interval);
    }, []);

    const switchMode = (next: Engine) => {
        setMode(next);
        localStorage.setItem(MODE_KEY, next);
    };

    const switchInterval = (next: Interval) => {
        setInterval(next);
        localStorage.setItem(INTERVAL_KEY, next);
    };

    // The indicators this chart actually carries, split by engine.
    const pineChips = chart.pineStudies
        .map((id) => findIndicator(id))
        .filter((i): i is NonNullable<typeof i> => Boolean(i))
        .map((indicator) => ({
            id: indicator.id,
            text: formatLegend(indicator, resolveInputs(indicator, pineInputs.values[chart.symbol]?.[indicator.id])),
            color: indicator.plots[0]?.color ?? '#a2a9b1',
        }));
    const studyChips = chart.studies.map((id) => ({
        id,
        text: published.find((p) => p.id === id)?.label ?? id.replace(/^STD;/, ''),
    }));

    return (
        <section className="hatch">
            <div className="section-head">
                <div className="flex min-w-0 items-center gap-2">
                    {editing ? (
                        <input
                            autoFocus
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onBlur={() => { onRename(name.trim() || chart.symbol); setEditing(false); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { onRename(name.trim() || chart.symbol); setEditing(false); } }}
                            className="rounded-md bg-hover px-2 py-1 text-sm outline-none"
                        />
                    ) : (
                        <button type="button" onClick={() => setEditing(true)} className="truncate text-left" title={t('renameHint')}>
                            <h2 className="section-title truncate">{chart.name}</h2>
                        </button>
                    )}
                    <span className="mono truncate text-[13px] text-faint">{chart.symbol}</span>
                </div>
                <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setExpanded((v) => !v)} className="icon-btn" title={t('expand')} aria-label={t('expand')}>
                        {expanded ? <Minimize2 /> : <Maximize2 />}
                    </button>
                    <button type="button" onClick={onRemove} className="icon-btn" title={t('remove')} aria-label={t('remove')}>
                        <X />
                    </button>
                </div>
            </div>
            <div className={cn('card', expanded && 'fixed inset-3 z-50 shadow-[0_0_0_4px_var(--frame),0_24px_60px_oklch(0_0_0/0.6)]')}>
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--frame)] px-2 py-1.5">
                    <div className="flex items-center gap-1">
                        {(['tv', 'pine'] as const).map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => switchMode(m)}
                                aria-pressed={mode === m}
                                title={m === 'tv' ? t('engineTvHint') : t('enginePineHint')}
                                className={cn(
                                    'rounded-[8px] px-2 py-1 text-[12px] transition-colors',
                                    mode === m ? 'bg-brand-soft text-brand-ink' : 'text-muted-foreground hover:bg-hover',
                                )}
                            >
                                {m === 'tv' ? 'TradingView' : 'Pine'}
                            </button>
                        ))}
                    </div>
                    {mode === 'pine' && (
                        <div className="flex items-center gap-1">
                            {TV_INTERVALS.map((iv) => (
                                <button
                                    key={iv.id}
                                    type="button"
                                    onClick={() => switchInterval(iv.id)}
                                    aria-pressed={interval === iv.id}
                                    className={cn(
                                        'mono rounded-[8px] px-1.5 py-0.5 text-[11px] transition-colors',
                                        interval === iv.id ? 'bg-brand-soft text-brand-ink' : 'text-muted-foreground hover:bg-hover',
                                    )}
                                >
                                    {iv.label}
                                </button>
                            ))}
                        </div>
                    )}
                    {mode === 'tv' && (
                        <span className="text-[12px] text-faint">{t('engineTvNote')}</span>
                    )}
                </div>

                {/* This chart's own indicators. Every chip is removable, and a Pine chip can be
                    tuned with its own settings dialog. */}
                {pineChips.length > 0 || studyChips.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--frame)] px-2 py-1.5">
                        {pineChips.map((chip) => (
                            <span
                                key={chip.id}
                                className="flex items-center gap-1 rounded-[10px] bg-brand-soft px-2 py-0.5 text-[12px] text-brand-ink"
                            >
                                <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-[2px]" style={{ backgroundColor: chip.color }} />
                                <span className="mono">{chip.text}</span>
                                <button
                                    type="button"
                                    onClick={() => onOpenSettings(chip.id)}
                                    title={t('indicatorSettings')}
                                    aria-label={`${t('indicatorSettings')}: ${chip.id}`}
                                    className="rounded-[6px] p-0.5 opacity-70 transition-opacity hover:opacity-100"
                                >
                                    <Settings2 className="h-3 w-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onTogglePine(chip.id)}
                                    title={t('removeIndicator')}
                                    aria-label={`${t('removeIndicator')}: ${chip.id}`}
                                    className="rounded-[6px] p-0.5 opacity-70 transition-opacity hover:opacity-100"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                        {studyChips.map((chip) => (
                            <span
                                key={chip.id}
                                className="flex items-center gap-1 rounded-[10px] bg-hover/70 px-2 py-0.5 text-[12px] text-muted-foreground"
                            >
                                <span className="mono">{chip.text}</span>
                                <button
                                    type="button"
                                    onClick={() => onToggleStudy(chip.id)}
                                    title={t('removeIndicator')}
                                    aria-label={`${t('removeIndicator')}: ${chip.id}`}
                                    className="rounded-[6px] p-0.5 opacity-70 transition-opacity hover:opacity-100"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                ) : null}

                <div className={expanded ? 'h-full' : undefined}>
                    {mode === 'tv' ? (
                        <TradingViewWidget scriptUrl={scriptUrl} config={config} height={expanded ? 600 : 420} />
                    ) : (
                        <PineChart
                            symbol={chart.symbol}
                            interval={interval}
                            indicatorIds={chart.pineStudies}
                            inputValues={pineInputs.forSymbol(chart.symbol)}
                            height={expanded ? 600 : 420}
                        />
                    )}
                </div>
            </div>
        </section>
    );
};

/**
 * The settings dialog of one Pine indicator on one chart.
 *
 * It lists the script's `input.*` values, so a script can be tuned the same way TradingView's
 * own settings dialog allows it.
 */
const PineSettingsDialog = ({
    symbol,
    indicatorId,
    values,
    onChange,
    onReset,
    onClose,
}: {
    symbol: string;
    indicatorId: string;
    values: Record<string, number | boolean | string>;
    onChange: (key: string, value: number | boolean | string) => void;
    onReset: () => void;
    onClose: () => void;
}) => {
    const t = useTranslations('Monitor');
    const indicator = findIndicator(indicatorId);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    if (!indicator) return null;

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
            role="dialog"
            aria-modal="true"
            aria-label={indicator.title}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="card w-full max-w-md p-4 shadow-[0_24px_60px_oklch(0_0_0/0.6)]">
                <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="section-title truncate">{indicator.title}</h3>
                        <p className="text-[12px] text-faint">
                            {indicator.source} — {indicator.description}
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className="icon-btn" title={t('close')} aria-label={t('close')}>
                        <X />
                    </button>
                </div>

                {indicator.inputs.length === 0 ? (
                    <p className="text-[13px] text-faint">{t('noSettings')}</p>
                ) : (
                    <div className="flex flex-col gap-3">
                        {indicator.inputs.map((input) => {
                            const value = values[input.key];
                            if (input.type === 'bool') {
                                return (
                                    <label key={input.key} className="flex items-center justify-between gap-3 text-[13px]">
                                        <span>{input.title}</span>
                                        <input
                                            type="checkbox"
                                            checked={Boolean(value)}
                                            onChange={(e) => onChange(input.key, e.target.checked)}
                                            className="h-4 w-4 accent-[var(--brand)]"
                                        />
                                    </label>
                                );
                            }
                            return (
                                <label key={input.key} className="flex flex-col gap-1 text-[13px]">
                                    <span className="flex items-baseline justify-between gap-2">
                                        <span>{input.title}</span>
                                        <span className="mono text-[12px] text-faint">{String(value ?? input.default)}</span>
                                    </span>
                                    <input
                                        type="number"
                                        value={String(value ?? input.default)}
                                        min={input.min}
                                        max={input.max}
                                        step={input.step ?? (input.type === 'int' ? 1 : 0.1)}
                                        onChange={(e) => {
                                            const next = Number(e.target.value);
                                            if (!Number.isFinite(next)) return;
                                            onChange(input.key, input.type === 'int' ? Math.round(next) : next);
                                        }}
                                        className="mono rounded-[10px] bg-hover/60 px-3 py-2 text-[13px] outline-none"
                                    />
                                </label>
                            );
                        })}
                    </div>
                )}

                <div className="mt-4 flex items-center justify-between gap-2">
                    <button type="button" onClick={onReset} className="btn btn-ghost h-9 px-3 text-[13px]">
                        {t('resetSettings')}
                    </button>
                    <button type="button" onClick={onClose} className="btn h-9 px-4 text-[13px]">
                        {t('close')}
                    </button>
                </div>
            </div>
        </div>
    );
};

const MonitorWall = ({ initialCharts }: { initialCharts: Chart[] }) => {
    const t = useTranslations('Monitor');
    const [charts, setCharts] = useState<Chart[]>(initialCharts);
    const [published, setPublished] = useState<Published[]>([]);
    const [symbol, setSymbol] = useState('');
    const [mounted, setMounted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState('');
    /** The chart the catalog applies to. */
    const [target, setTarget] = useState<string>('');
    const [settingsFor, setSettingsFor] = useState<{ symbol: string; id: string } | null>(null);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // The settings of every Pine indicator, per chart.
    const pineInputs = usePineInputs();

    // Load the wall from the account first; fall back to this browser's copy if the user is not
    // signed in (the page is behind auth, but a stale session should still show something).
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const config = await getMonitorConfig();
                if (cancelled) return;
                if (config.charts.length) setCharts(normalizeCharts(config.charts, initialCharts));
                setPublished(config.published);
                if (config.charts.length === 0) {
                    const local = readJson<Chart[]>(CHARTS_KEY, []);
                    if (local.length) setCharts(normalizeCharts(local, initialCharts));
                }
            } catch {
                if (cancelled) return;
                setCharts(normalizeCharts(readJson<Chart[]>(CHARTS_KEY, []), initialCharts));
                setPublished(readJson<Published[]>(PUBLISHED_KEY, []));
            }
        })();
        return () => { cancelled = true; };
    }, [initialCharts]);

    // The mirror and the save both wait for this flag, so it has to be flipped once the first
    // load has settled — otherwise the wall would push an empty layout over the stored one.
    useEffect(() => {
        setMounted(true);
    }, []);

    // The first chart is the default target of the indicator catalog.
    useEffect(() => {
        if (!target && charts.length) setTarget(charts[0].symbol);
    }, [charts, target]);

    // Mirror to localStorage so a reload never blanks the wall, then push to the account.
    useEffect(() => { if (mounted) localStorage.setItem(CHARTS_KEY, JSON.stringify(charts)); }, [charts, mounted]);
    useEffect(() => { if (mounted) localStorage.setItem(PUBLISHED_KEY, JSON.stringify(published)); }, [published, mounted]);

    useEffect(() => {
        if (!mounted) return;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            setSaving(true);
            void saveMonitorConfig({
                charts: charts.map((c) => ({ symbol: c.symbol, name: c.name, studies: c.studies, pineStudies: c.pineStudies })),
                published,
            })
                .catch(() => setNotice(t('saveFailed')))
                .finally(() => setSaving(false));
        }, 600);
        return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    }, [charts, published, mounted, t]);

    /** Apply a change to one chart, identified by its symbol. */
    const patchChart = useCallback((symbol: string, patch: Partial<Chart>) => {
        setCharts((current) =>
            current.map((c) => (c.symbol === symbol ? { ...c, ...patch } : c)),
        );
    }, []);

    const togglePine = useCallback(
        (chartSymbol: string, id: string) => {
            setCharts((current) =>
                current.map((c) => {
                    if (c.symbol !== chartSymbol) return c;
                    const pineStudies = c.pineStudies.includes(id)
                        ? c.pineStudies.filter((s) => s !== id)
                        : [...c.pineStudies, id];
                    return { ...c, pineStudies };
                }),
            );
        },
        [],
    );

    const toggleStudy = useCallback(
        (chartSymbol: string, id: string) => {
            setCharts((current) =>
                current.map((c) => {
                    if (c.symbol !== chartSymbol) return c;
                    const studies = c.studies.includes(id)
                        ? c.studies.filter((s) => s !== id)
                        : [...c.studies, id];
                    return { ...c, studies };
                }),
            );
        },
        [],
    );

    const addChart = () => {
        const clean = symbol.trim().toUpperCase();
        if (!SYMBOL_PATTERN.test(clean)) return;

        setCharts((current) =>
            current.some((c) => c.symbol === clean)
                ? current
                : [...current, { symbol: clean, name: clean, studies: [], pineStudies: [] }],
        );
        setSymbol('');
    };

    // Accepts one id or a whole batch: paste every id you published, separated by newlines.
    const addPublished = () => {
        const ids = splitPublished(symbol);
        const valid = ids.filter((id) => PUBLISHED_PATTERN.test(id));
        const rejected = ids.length - valid.length;
        if (!valid.length) {
            if (rejected) setNotice(t('badPublishedId'));
            return;
        }

        setPublished((current) => {
            const merged = [...current];
            for (const id of valid) {
                if (!merged.some((p) => p.id === id)) {
                    merged.push({ id, label: id.split('/').pop() ?? id });
                }
            }
            return merged;
        });
        setSymbol('');
        setNotice(rejected ? t('someIdsRejected', { count: rejected }) : '');
    };

    const allStudies = [...BUILT_IN.map((i) => ({ id: i.id, label: i.label })), ...published];
    const targetChart = charts.find((c) => c.symbol === target) ?? null;

    return (
        <div className="flex flex-col gap-3">
            <div className="hatch">
                <div className="section-head">
                    <div className="min-w-0">
                        <h2 className="section-title">{t('indicatorsTitle')}</h2>
                        <p className="section-sub">{t('indicatorsSub')}</p>
                    </div>
                </div>
                <div className="card flex flex-col gap-3 p-3">
                    {/* Which chart the catalog applies to. Every chart carries its own set. */}
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12px] text-faint">{t('applyTo')}</span>
                        <div className="flex flex-wrap items-center gap-1">
                            {charts.map((c) => (
                                <button
                                    key={c.symbol}
                                    type="button"
                                    onClick={() => setTarget(c.symbol)}
                                    aria-pressed={target === c.symbol}
                                    className={cn(
                                        'rounded-[8px] px-2 py-1 text-[12px] transition-colors',
                                        target === c.symbol ? 'bg-brand-soft text-brand-ink' : 'text-muted-foreground hover:bg-hover',
                                    )}
                                >
                                    {c.name}
                                </button>
                            ))}
                        </div>
                        {charts.length > 1 && (
                            <button
                                type="button"
                                onClick={() => {
                                    const ids = targetChart?.pineStudies ?? [];
                                    setCharts((current) => current.map((c) => ({ ...c, pineStudies: [...ids] })));
                                }}
                                className="btn btn-ghost h-8 px-3 text-[12px]"
                                title={t('applyToAllHint')}
                            >
                                {t('applyToAll')}
                            </button>
                        )}
                    </div>

                    <div>
                        <p className="mb-2 text-[12px] text-faint">{t('enginePineHint')}</p>
                        <div className="flex flex-wrap gap-2">
                            {PINE_INDICATORS.map((i) => {
                                const active = targetChart?.pineStudies.includes(i.id) ?? false;
                                return (
                                    <button
                                        key={i.id}
                                        type="button"
                                        onClick={() => target && togglePine(target, i.id)}
                                        aria-pressed={active}
                                        title={`${i.title} — ${i.description}`}
                                        className={cn(
                                            'rounded-[10px] px-3 py-1.5 text-[13px] transition-colors',
                                            active
                                                ? 'bg-brand-soft text-brand-ink'
                                                : 'bg-hover/60 text-muted-foreground hover:bg-hover',
                                        )}
                                    >
                                        {i.shorttitle}
                                    </button>
                                );
                            })}
                            {PINE_INDICATORS.length === 0 && <span className="text-[13px] text-faint">{t('noIndicators')}</span>}
                        </div>
                    </div>
                    <div>
                        <p className="mb-2 text-[12px] text-faint">{t('engineTvHint')}</p>
                        <div className="flex flex-wrap gap-2">
                            {allStudies.map((s) => {
                                const active = targetChart?.studies.includes(s.id) ?? false;
                                return (
                                    <button
                                        key={s.id}
                                        type="button"
                                        onClick={() => target && toggleStudy(target, s.id)}
                                        aria-pressed={active}
                                        title={s.id}
                                        className={cn(
                                            'rounded-[10px] px-3 py-1.5 text-[13px] transition-colors',
                                            active
                                                ? 'bg-brand-soft text-brand-ink'
                                                : 'bg-hover/60 text-muted-foreground hover:bg-hover',
                                        )}
                                    >
                                        {s.label}
                                    </button>
                                );
                            })}
                            {allStudies.length === 0 && <span className="text-[13px] text-faint">{t('noIndicators')}</span>}
                        </div>
                    </div>
                </div>
            </div>

            <div className="hatch">
                <div className="section-head">
                    <div className="min-w-0">
                        <h2 className="section-title">{t('addChartTitle')}</h2>
                        <p className="section-sub">{t('addChartSub')}</p>
                    </div>
                </div>
                <div className="card flex flex-col gap-2 p-3">
                    <div className="flex gap-2">
                        <input
                            value={symbol}
                            onChange={(e) => setSymbol(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') addChart(); }}
                            placeholder="BINANCE:BTCUSDT"
                            className="mono min-w-0 flex-1 rounded-[10px] bg-hover/60 px-3 py-2 text-[13px] outline-none"
                        />
                        <button type="button" onClick={addChart} className="btn btn-ghost h-9 px-3 text-[13px]">{t('add')}</button>
                    </div>
                    <div className="flex gap-2">
                        <textarea
                            value={symbol}
                            onChange={(e) => setSymbol(e.target.value)}
                            rows={2}
                            placeholder={t('publishedPlaceholder')}
                            className="mono min-w-0 flex-1 rounded-[10px] bg-hover/60 px-3 py-2 text-[13px] outline-none"
                        />
                        <button type="button" onClick={addPublished} className="btn btn-ghost h-9 px-3 text-[13px]">{t('addPublished')}</button>
                    </div>
                    <p className="text-[12px] text-faint">{t('publishedHint')}</p>
                </div>
            </div>

            <div className="hatch">
                <div className="section-head">
                    <div className="min-w-0">
                        <h2 className="section-title">{t('wallStatus')}</h2>
                    </div>
                </div>
                <div className="card flex flex-wrap items-center gap-3 p-3 text-[13px] text-muted-foreground">
                    <span>{saving ? t('saving') : t('saved')}</span>
                    <span className="mono text-faint">{charts.length} {t('chartsLabel')} · {t('perChartIndicators')}</span>
                    {notice && <span className="text-amber-600 dark:text-amber-400">{notice}</span>}
                </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
                {charts.map((chart) => (
                    <ChartCard
                        key={chart.symbol}
                        chart={chart}
                        published={published}
                        pineInputs={pineInputs}
                        onRemove={() => setCharts((current) => current.filter((c) => c.symbol !== chart.symbol))}
                        onRename={(name) => patchChart(chart.symbol, { name })}
                        onTogglePine={(id) => togglePine(chart.symbol, id)}
                        onToggleStudy={(id) => toggleStudy(chart.symbol, id)}
                        onOpenSettings={(id) => setSettingsFor({ symbol: chart.symbol, id })}
                    />
                ))}
            </div>

            {charts.length === 0 && (
                <div className="card p-8 text-center text-[13px] text-faint">{t('empty')}</div>
            )}

            {settingsFor && (
                <PineSettingsDialog
                    symbol={settingsFor.symbol}
                    indicatorId={settingsFor.id}
                    values={pineInputs.forIndicator(settingsFor.symbol, settingsFor.id)}
                    onChange={(key, value) => pineInputs.update(settingsFor.symbol, settingsFor.id, key, value)}
                    onReset={() => pineInputs.reset(settingsFor.symbol, settingsFor.id)}
                    onClose={() => setSettingsFor(null)}
                />
            )}
        </div>
    );
};

export default function MonitorPage({ initialCharts }: { initialCharts: Chart[] }) {
    const t = useTranslations('Monitor');

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">{t('title')}</h1>
                    <p className="page-sub">{t('sub')}</p>
                </div>
            </header>
            <MonitorWall initialCharts={initialCharts} />
        </>
    );
}
