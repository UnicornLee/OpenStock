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

type Chart = { symbol: string; name: string };
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

const ChartCard = ({
    chart,
    studies,
    pineIds,
    inputValues,
    onRemove,
    onRename,
}: {
    chart: Chart;
    studies: string[];
    pineIds: string[];
    inputValues: Record<string, Record<string, number | boolean | string>>;
    onRemove: () => void;
    onRename: (name: string) => void;
}) => {
    const t = useTranslations('Monitor');
    const [expanded, setExpanded] = useState(false);
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(chart.name);
    const [mode, setMode] = useState<Engine>('tv');
    const [interval, setInterval] = useState<Interval>('5m');

    const config = useMemo(
        () => ({ ...CANDLE_CHART_WIDGET_CONFIG(chart.symbol), studies }),
        [chart.symbol, studies],
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
                <div className="flex items-center gap-2 border-b border-[var(--frame)] px-2 py-1.5">
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
                <div className={expanded ? 'h-full' : undefined}>
                    {mode === 'tv' ? (
                        <TradingViewWidget scriptUrl={scriptUrl} config={config} height={expanded ? 600 : 420} />
                    ) : (
                        <PineChart
                            symbol={chart.symbol}
                            interval={interval}
                            indicatorIds={pineIds}
                            inputValues={inputValues}
                            height={expanded ? 600 : 420}
                        />
                    )}
                </div>
            </div>
        </section>
    );
};

/**
 * The settings dialog of one Pine indicator.
 *
 * It lists the script's `input.*` values, so a script can be tuned the same way TradingView's
 * own settings dialog allows it.
 */
const PineSettingsDialog = ({
    indicatorId,
    values,
    onChange,
    onReset,
    onClose,
}: {
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
    const [studies, setStudies] = useState<string[]>([]);
    const [published, setPublished] = useState<Published[]>([]);
    const [pineStudies, setPineStudies] = useState<string[]>([]);
    const [symbol, setSymbol] = useState('');
    const [mounted, setMounted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState('');
    const [settingsFor, setSettingsFor] = useState<string | null>(null);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // The settings of every Pine indicator on the wall; shared by all cards.
    const pineInputs = usePineInputs();

    // Load the wall from the account first; fall back to this browser's copy if the user is not
    // signed in (the page is behind auth, but a stale session should still show something).
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const config = await getMonitorConfig();
                if (cancelled) return;
                if (config.charts.length) setCharts(config.charts);
                setStudies(config.studies);
                setPublished(config.published);
                setPineStudies(config.pineStudies ?? []);
                if (config.charts.length === 0) {
                    const local = readJson<Chart[]>(CHARTS_KEY, []);
                    if (local.length) setCharts(local);
                }
            } catch {
                if (cancelled) return;
                setCharts(readJson<Chart[]>(CHARTS_KEY, initialCharts));
                setStudies(readJson<string[]>(STUDIES_KEY, []));
                setPublished(readJson<Published[]>(PUBLISHED_KEY, []));
                setPineStudies(readJson<string[]>(PINE_KEY, []));
            }
        })();
        return () => { cancelled = true; };
    }, [initialCharts]);

    // The mirror and the save both wait for this flag, so it has to be flipped once the first
    // load has settled — otherwise the wall would push an empty layout over the stored one.
    useEffect(() => {
        setMounted(true);
    }, []);

    // Mirror to localStorage so a reload never blanks the wall, then push to the account.
    useEffect(() => { if (mounted) localStorage.setItem(CHARTS_KEY, JSON.stringify(charts)); }, [charts, mounted]);
    useEffect(() => { if (mounted) localStorage.setItem(STUDIES_KEY, JSON.stringify(studies)); }, [studies, mounted]);
    useEffect(() => { if (mounted) localStorage.setItem(PUBLISHED_KEY, JSON.stringify(published)); }, [published, mounted]);
    useEffect(() => { if (mounted) localStorage.setItem(PINE_KEY, JSON.stringify(pineStudies)); }, [pineStudies, mounted]);

    useEffect(() => {
        if (!mounted) return;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            setSaving(true);
            void saveMonitorConfig({ charts, studies, published, pineStudies })
                .catch(() => setNotice(t('saveFailed')))
                .finally(() => setSaving(false));
        }, 600);
        return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    }, [charts, studies, published, pineStudies, mounted, t]);

    const toggleStudy = useCallback((id: string) => {
        setStudies((current) => (current.includes(id) ? current.filter((s) => s !== id) : [...current, id]));
    }, []);

    const togglePine = useCallback((id: string) => {
        setPineStudies((current) => (current.includes(id) ? current.filter((s) => s !== id) : [...current, id]));
    }, []);

    const addChart = () => {
        const clean = symbol.trim().toUpperCase();
        if (!SYMBOL_PATTERN.test(clean)) return;

        setCharts((current) =>
            current.some((c) => c.symbol === clean) ? current : [...current, { symbol: clean, name: clean }],
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
        setStudies((current) => {
            const merged = [...current];
            for (const id of valid) if (!merged.includes(id)) merged.push(id);
            return merged;
        });
        setSymbol('');
        setNotice(rejected ? t('someIdsRejected', { count: rejected }) : '');
    };

    const allStudies = [...BUILT_IN.map((i) => ({ id: i.id, label: i.label })), ...published];

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
                    <div>
                        <p className="mb-2 text-[12px] text-faint">{t('enginePineHint')}</p>
                        <div className="flex flex-wrap gap-2">
                            {PINE_INDICATORS.map((i) => {
                                const active = pineStudies.includes(i.id);
                                const effective = resolveInputs(i, pineInputs.values[i.id]);
                                return (
                                    <span
                                        key={i.id}
                                        className={cn(
                                            'flex items-center gap-1 rounded-[10px] pl-1 pr-0.5 transition-colors',
                                            active ? 'bg-brand-soft text-brand-ink' : 'bg-hover/60 text-muted-foreground hover:bg-hover',
                                        )}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => togglePine(i.id)}
                                            aria-pressed={active}
                                            title={`${i.title} — ${i.description}`}
                                            className="px-2 py-1.5 text-[13px]"
                                        >
                                            {active ? formatLegend(i, effective) : i.shorttitle}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSettingsFor(i.id)}
                                            title={t('indicatorSettings')}
                                            aria-label={`${t('indicatorSettings')}: ${i.title}`}
                                            className="rounded-[6px] p-1 opacity-70 transition-opacity hover:opacity-100"
                                        >
                                            <Settings2 className="h-3.5 w-3.5" />
                                        </button>
                                    </span>
                                );
                            })}
                            {PINE_INDICATORS.length === 0 && <span className="text-[13px] text-faint">{t('noIndicators')}</span>}
                        </div>
                    </div>
                    <div>
                        <p className="mb-2 text-[12px] text-faint">{t('engineTvHint')}</p>
                        <div className="flex flex-wrap gap-2">
                            {allStudies.map((s) => (
                                <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => toggleStudy(s.id)}
                                    aria-pressed={studies.includes(s.id)}
                                    title={s.id}
                                    className={cn(
                                        'rounded-[10px] px-3 py-1.5 text-[13px] transition-colors',
                                        studies.includes(s.id)
                                            ? 'bg-brand-soft text-brand-ink'
                                            : 'bg-hover/60 text-muted-foreground hover:bg-hover',
                                    )}
                                >
                                    {s.label}
                                </button>
                            ))}
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
                    <span className="mono text-faint">{charts.length} {t('chartsLabel')} · {studies.length} {t('studiesLabel')} · {pineStudies.length} {t('pineLabel')}</span>
                    {notice && <span className="text-amber-600 dark:text-amber-400">{notice}</span>}
                </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
                {charts.map((chart) => (
                    <ChartCard
                        key={chart.symbol}
                        chart={chart}
                        studies={studies}
                        pineIds={pineStudies}
                        inputValues={pineInputs.values}
                        onRemove={() => setCharts((current) => current.filter((c) => c.symbol !== chart.symbol))}
                        onRename={(name) => setCharts((current) => current.map((c) => (c.symbol === chart.symbol ? { ...c, name } : c)))}
                    />
                ))}
            </div>

            {charts.length === 0 && (
                <div className="card p-8 text-center text-[13px] text-faint">{t('empty')}</div>
            )}

            {settingsFor && (
                <PineSettingsDialog
                    indicatorId={settingsFor}
                    values={pineInputs.forIndicator(settingsFor)}
                    onChange={(key, value) => pineInputs.update(settingsFor, key, value)}
                    onReset={() => pineInputs.reset(settingsFor)}
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
