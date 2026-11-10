'use client';

/**
 * Per-indicator settings for the self-hosted Pine engine.
 *
 * Every ported script declares its Pine `input.*` values in `lib/pine/indicators.ts`. Those
 * defaults are what the chart draws out of the box; this store holds the user's overrides so
 * a wall can be tuned without touching the code, and mirrors them into localStorage so a
 * reload keeps the same setup.
 */

import { useCallback, useEffect, useState } from 'react';
import { findIndicator, type PineIndicator } from './indicators';

const STORAGE_KEY = 'openstock:monitor-pine-inputs';

export type PineInputValues = Record<string, Record<string, number | boolean | string>>;

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
 * It keeps one copy for the whole page, so a value changed in the settings dialog is seen by
 * every chart that draws that indicator.
 */
export function usePineInputs() {
    const [values, setValues] = useState<PineInputValues>({});
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        setValues(readAll());
        setLoaded(true);
    }, []);

    const update = useCallback((indicatorId: string, key: string, value: number | boolean | string) => {
        setValues((current) => {
            const next: PineInputValues = {
                ...current,
                [indicatorId]: { ...(current[indicatorId] ?? {}), [key]: value },
            };
            writeAll(next);
            return next;
        });
    }, []);

    const reset = useCallback((indicatorId: string) => {
        setValues((current) => {
            const next = { ...current };
            delete next[indicatorId];
            writeAll(next);
            return next;
        });
    }, []);

    const resetAll = useCallback(() => {
        setValues({});
        writeAll({});
    }, []);

    /** The values one indicator should be computed with. */
    const forIndicator = useCallback(
        (indicatorId: string): Record<string, number | boolean | string> => {
            const indicator = findIndicator(indicatorId);
            if (!indicator) return {};
            return resolveInputs(indicator, values[indicatorId]);
        },
        [values],
    );

    return { values, loaded, update, reset, resetAll, forIndicator };
}
