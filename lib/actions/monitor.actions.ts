'use server';

import { connectToDatabase } from '@/database/mongoose';
import { monitorConfigModel } from '@/database/models/monitor-config.model';
import { requireUserId } from '@/lib/better-auth/auth';

// The monitoring wall used to live entirely in one browser's localStorage, so clearing site data or
// switching machines threw the layout away. It now belongs to the account and is stored server-side.

export interface MonitorChartInput {
    symbol: string;
    name: string;
    /** TradingView study ids enabled on this chart. */
    studies?: string[];
    /** Ids of the self-hosted Pine indicators enabled on this chart. */
    pineStudies?: string[];
}

export interface MonitorPublishedInput {
    id: string;
    label: string;
}

// TradingView symbol tickers: BINANCE:BTCUSDT, NASDAQ:AAPL, OANDA:EURUSD.
const SYMBOL_PATTERN = /^[A-Z0-9.:\-]{1,20}$/;
// A published indicator id: PUB;<user>/<script>. The user name may contain dots, the script name
// anything that is not a slash.
const PUBLISHED_PATTERN = /^PUB;[^\s/]{1,64}\/[^\s]{1,80}$/;

const MAX_CHARTS = 24;
const MAX_STUDIES = 40;
const MAX_PUBLISHED = 40;
const MAX_PINE_STUDIES = 40;

// The self-hosted chart only knows the indicators shipped in `lib/pine/indicators.ts`.
const PINE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

const cleanList = (values: unknown[], max: number): string[] =>
    [...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))].slice(0, max);

export async function getMonitorConfig() {
    const userId = await requireUserId();
    try {
        const Model = monitorConfigModel(await connectToDatabase());
        const doc = await Model.findOne({ userId }).lean();
        if (!doc) return { charts: [], studies: [], published: [], pineStudies: [] };
        return {
            charts: (doc.charts ?? []).map((c) => ({
                symbol: c.symbol,
                name: c.name,
                studies: c.studies ?? [],
                pineStudies: c.pineStudies ?? [],
            })),
            studies: doc.studies ?? [],
            published: (doc.published ?? []).map((p) => ({ id: p.id, label: p.label })),
            pineStudies: doc.pineStudies ?? [],
        };
    } catch (error) {
        console.error('Error reading monitor config:', error);
        return { charts: [], studies: [], published: [], pineStudies: [] };
    }
}

export async function saveMonitorConfig(input: {
    charts?: MonitorChartInput[];
    studies?: string[];
    published?: MonitorPublishedInput[];
    pineStudies?: string[];
}) {
    const userId = await requireUserId();
    try {
        const charts = (input.charts ?? [])
            .map((c) => ({
                symbol: String(c?.symbol ?? '').trim().toUpperCase(),
                name: String(c?.name ?? '').trim().slice(0, 60),
                studies: cleanList(c?.studies ?? [], MAX_STUDIES),
                pineStudies: cleanList(c?.pineStudies ?? [], MAX_PINE_STUDIES).filter((s) =>
                    PINE_ID_PATTERN.test(s),
                ),
            }))
            .filter((c) => SYMBOL_PATTERN.test(c.symbol))
            .slice(0, MAX_CHARTS);

        const studies = cleanList(input.studies ?? [], MAX_STUDIES);

        const published = (input.published ?? [])
            .map((p) => ({
                id: String(p?.id ?? '').trim(),
                label: String(p?.label ?? '').trim().slice(0, 80),
            }))
            .filter((p) => PUBLISHED_PATTERN.test(p.id))
            .slice(0, MAX_PUBLISHED);

        const pineStudies = [...new Set((input.pineStudies ?? []).map((s) => String(s ?? '').trim().toLowerCase()).filter(Boolean))]
            .filter((s) => PINE_ID_PATTERN.test(s))
            .slice(0, MAX_PINE_STUDIES);

        const Model = monitorConfigModel(await connectToDatabase());
        const updated = await Model.findOneAndUpdate(
            { userId },
            { $set: { charts, studies, published, pineStudies, updatedAt: new Date() } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();

        return {
            charts: updated?.charts ?? [],
            studies: updated?.studies ?? [],
            published: updated?.published ?? [],
            pineStudies: updated?.pineStudies ?? [],
        };
    } catch (error) {
        console.error('Error saving monitor config:', error);
        throw new Error('Failed to save monitor config');
    }
}
