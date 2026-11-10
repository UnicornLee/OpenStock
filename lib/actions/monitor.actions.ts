'use server';

import { connectToDatabase } from '@/database/mongoose';
import { monitorConfigModel } from '@/database/models/monitor-config.model';
import { requireUserId } from '@/lib/better-auth/auth';

// The monitoring wall used to live entirely in one browser's localStorage, so clearing site data or
// switching machines threw the layout away. It now belongs to the account and is stored server-side.

export interface MonitorChartInput {
    symbol: string;
    name: string;
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

export async function getMonitorConfig() {
    const userId = await requireUserId();
    try {
        const Model = monitorConfigModel(await connectToDatabase());
        const doc = await Model.findOne({ userId }).lean();
        if (!doc) return { charts: [], studies: [], published: [] };
        return {
            charts: (doc.charts ?? []).map((c) => ({ symbol: c.symbol, name: c.name })),
            studies: doc.studies ?? [],
            published: (doc.published ?? []).map((p) => ({ id: p.id, label: p.label })),
        };
    } catch (error) {
        console.error('Error reading monitor config:', error);
        return { charts: [], studies: [], published: [] };
    }
}

export async function saveMonitorConfig(input: {
    charts?: MonitorChartInput[];
    studies?: string[];
    published?: MonitorPublishedInput[];
}) {
    const userId = await requireUserId();
    try {
        const charts = (input.charts ?? [])
            .map((c) => ({
                symbol: String(c?.symbol ?? '').trim().toUpperCase(),
                name: String(c?.name ?? '').trim().slice(0, 60),
            }))
            .filter((c) => SYMBOL_PATTERN.test(c.symbol))
            .slice(0, MAX_CHARTS);

        const studies = [...new Set((input.studies ?? []).map((s) => String(s ?? '').trim()).filter(Boolean))].slice(0, MAX_STUDIES);

        const published = (input.published ?? [])
            .map((p) => ({
                id: String(p?.id ?? '').trim(),
                label: String(p?.label ?? '').trim().slice(0, 80),
            }))
            .filter((p) => PUBLISHED_PATTERN.test(p.id))
            .slice(0, MAX_PUBLISHED);

        const Model = monitorConfigModel(await connectToDatabase());
        const updated = await Model.findOneAndUpdate(
            { userId },
            { $set: { charts, studies, published, updatedAt: new Date() } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();

        return {
            charts: updated?.charts ?? [],
            studies: updated?.studies ?? [],
            published: updated?.published ?? [],
        };
    } catch (error) {
        console.error('Error saving monitor config:', error);
        throw new Error('Failed to save monitor config');
    }
}
