'use client';

/**
 * Per-indicator settings for the self-hosted Pine engine.
 *
 * Every ported script declares its Pine `input.*` values in `lib/pine/indicators.ts`. Those
 * defaults are what the chart draws out of the box; this store holds the user's overrides so
 * a wall can be tuned without touching the code, and mirrors them into localStorage so a
 * reload keeps the same setup.
 *
 * Settings are **per chart**: two charts can carry the same indicator with different values
 * (a 14-period stochastic on one symbol, a 21-period one on another), so the store is keyed by
 * chart symbol first and indicator id second.
 */

import { useCallback, useEffect, useState } from 'react';
import { findIndicator, type PineIndicator } from './indicators';

const STORAGE_KEY = 'openstock:monitor-pine-inputs';

/** chart symbol -> indicator id -> input key -> value */
export type PineInputValues = Record<string, Record<string, Record<string, number | boolean | string>>>;

const readAll = (): PineInputValues => {
    if (typeof window === 'undefined') return {};
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? (parsed as PineInputValues) : {};
    } catch {
        return {};
    }
};

const writeAll = (values: PineInputValues) => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    } catch {
        // A full or blocked localStorage must not break the chart.
    }
};

/** The effective values of one indicator: the user's overrides on top of the Pine defaults. */
export const resolveInputs = (
    indicator: PineIndicator,
    overrides?: Record<string, number | boolean | string>,
): Record<string, number | boolean | string> => {
    const result: Record<string, number | boolean | string> = {};
    for (const input of indicator.inputs) {
        const override = overrides?.[input.key];
        result[input.key] = override === undefined ? input.default : override;
    }
    return result;
};

/**
 * A one-line description of an indicator's current settings, the way TradingView shows it in
 * the legend: `Stoch 14 3 3`.
 */
export const formatLegend = (
    indicator: PineIndicator,
    values: Record<string, number | boolean | string>,
): string => {
    const parts = indicator.inputs
        .map((input) => {
            const value = values[input.key];
            if (value === undefined) return null;
            if (typeof value === 'boolean') return value ? 'on' : 'off';
            if (typeof value === 'number') {
                return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
            }
            return String(value);
        })
        .filter((p): p is string => Boolean(p));
    return parts.length ? `${indicator.shorttitle} ${parts.join(' ')}` : indicator.shorttitle;
};

/**
 * A small React store for the settings of every indicator on the wall.
 *
 * The settings belong to a chart, not to the wall: each chart keeps its own copy, so tuning the
 * stochastic on one symbol leaves the others alone.
 */
export function usePineInputs() {
    const [values, setValues] = useState<PineInputValues>({});
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        setValues(readAll());
        setLoaded(true);
    }, []);

    const update = useCallback(
        (symbol: string, indicatorId: string, key: string, value: number | boolean | string) => {
            setValues((current) => {
                const byIndicator = current[symbol] ?? {};
                const next: PineInputValues = {
                    ...current,
                    [symbol]: {
                        ...byIndicator,
                        [indicatorId]: { ...(byIndicator[indicatorId] ?? {}), [key]: value },
                    },
                };
                writeAll(next);
                return next;
            });
        },
        [],
    );

    const reset = useCallback((symbol: string, indicatorId: string) => {
        setValues((current) => {
            const byIndicator = current[symbol] ?? {};
            const nextIndicator = { ...byIndicator };
            delete nextIndicator[indicatorId];
            const next: PineInputValues = { ...current, [symbol]: nextIndicator };
            writeAll(next);
            return next;
        });
    }, []);

    const resetAll = useCallback((symbol?: string) => {
        setValues((current) => {
            const next = { ...current };
            if (symbol) delete next[symbol];
            else for (const key of Object.keys(next)) delete next[key];
            writeAll(next);
            return next;
        });
    }, []);

    /** The values one indicator on one chart should be computed with. */
    const forIndicator = useCallback(
        (symbol: string, indicatorId: string): Record<string, number | boolean | string> => {
            const indicator = findIndicator(indicatorId);
            if (!indicator) return {};
            return resolveInputs(indicator, values[symbol]?.[indicatorId]);
        },
        [values],
    );

    /** Every chart's settings, ready to hand to a chart component. */
    const forSymbol = useCallback(
        (symbol: string): Record<string, Record<string, number | boolean | string>> =>
            values[symbol] ?? {},
        [values],
    );

    return { values, loaded, update, reset, resetAll, forIndicator, forSymbol };
}
