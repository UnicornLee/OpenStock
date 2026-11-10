'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import TradingViewWidget from '@/components/TradingViewWidget';
import { CANDLE_CHART_WIDGET_CONFIG } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { getMonitorConfig, saveMonitorConfig } from '@/lib/actions/monitor.actions';

// A monitoring wall: many charts at once, each with any number of indicators.
// TradingView's free embed caps a single chart at two indicators, so a self-hosted wall
// is the only way to watch more than that in one view.

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

// A sensible default wall, so the page is useful before anything is configured.
const DEFAULT_CHARTS = [
    { symbol: 'BINANCE:BTCUSDT', name: 'Bitcoin' },
    { symbol: 'BINANCE:ETHUSDT', name: 'Ethereum' },
    { symbol: 'BINANCE:XAUTUSDT', name: 'Tether Gold' },
    { symbol: 'BINANCE:SOLUSDT', name: 'Solana' },
];

type Chart = { symbol: string; name: string };
type Published = { id: string; label: string };

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
    onRemove,
    onRename,
}: {
    chart: Chart;
    studies: string[];
    onRemove: () => void;
    onRename: (name: string) => void;
}) => {
    const t = useTranslations('Monitor');
    const [expanded, setExpanded] = useState(false);
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(chart.name);

    const config = useMemo(
        () => ({ ...CANDLE_CHART_WIDGET_CONFIG(chart.symbol), studies }),
        [chart.symbol, studies],
    );

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
                <div className={expanded ? 'h-full' : undefined}>
                    <TradingViewWidget scriptUrl={scriptUrl} config={config} height={expanded ? 600 : 420} />
                </div>
            </div>
        </section>
    );
};

const MonitorWall = ({ initialCharts }: { initialCharts: Chart[] }) => {
    const t = useTranslations('Monitor');
    const [charts, setCharts] = useState<Chart[]>(initialCharts);
    const [studies, setStudies] = useState<string[]>([]);
    const [published, setPublished] = useState<Published[]>([]);
    const [symbol, setSymbol] = useState('');
    const [mounted, setMounted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState('');
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
                if (config.charts.length === 0) {
                    const local = readJson<Chart[]>(CHARTS_KEY, []);
                    if (local.length) setCharts(local);
                }
            } catch {
                if (cancelled) return;
                setCharts(readJson<Chart[]>(CHARTS_KEY, initialCharts));
                setStudies(readJson<string[]>(STUDIES_KEY, []));
                setPublished(readJson<Published[]>(PUBLISHED_KEY, []));
            }
        })();
        return () => { cancelled = true; };
    }, [initialCharts]);

    // Mirror to localStorage so a reload never blanks the wall, then push to the account.
    useEffect(() => { if (mounted) localStorage.setItem(CHARTS_KEY, JSON.stringify(charts)); }, [charts, mounted]);
    useEffect(() => { if (mounted) localStorage.setItem(STUDIES_KEY, JSON.stringify(studies)); }, [studies, mounted]);
    useEffect(() => { if (mounted) localStorage.setItem(PUBLISHED_KEY, JSON.stringify(published)); }, [published, mounted]);

    useEffect(() => {
        if (!mounted) return;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            setSaving(true);
            void saveMonitorConfig({ charts, studies, published })
                .catch(() => setNotice(t('saveFailed')))
                .finally(() => setSaving(false));
        }, 600);
        return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    }, [charts, studies, published, mounted, t]);

    const toggleStudy = useCallback((id: string) => {
        setStudies((current) => (current.includes(id) ? current.filter((s) => s !== id) : [...current, id]));
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
                <div className="card flex flex-wrap gap-2 p-3">
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
                    <span className="mono text-faint">{charts.length} {t('chartsLabel')} · {studies.length} {t('studiesLabel')}</span>
                    {notice && <span className="text-amber-600 dark:text-amber-400">{notice}</span>}
                </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
                {charts.map((chart) => (
                    <ChartCard
                        key={chart.symbol}
                        chart={chart}
                        studies={studies}
                        onRemove={() => setCharts((current) => current.filter((c) => c.symbol !== chart.symbol))}
                        onRename={(name) => setCharts((current) => current.map((c) => (c.symbol === chart.symbol ? { ...c, name } : c)))}
                    />
                ))}
            </div>

            {charts.length === 0 && (
                <div className="card p-8 text-center text-[13px] text-faint">{t('empty')}</div>
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
