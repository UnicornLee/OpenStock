import { getTranslations } from 'next-intl/server';
import MonitorWall from '@/components/MonitorWall';
import { getMonitorConfig } from '@/lib/actions/monitor.actions';

const DEFAULT_CHARTS = [
    { symbol: 'BINANCE:BTCUSDT', name: 'Bitcoin' },
    { symbol: 'BINANCE:ETHUSDT', name: 'Ethereum' },
    { symbol: 'BINANCE:XAUTUSDT', name: 'Tether Gold' },
    { symbol: 'BINANCE:SOLUSDT', name: 'Solana' },
];

export default async function MonitorPage() {
    const t = await getTranslations('Monitor');

    // The wall belongs to the account, so read it on the server. An anonymous or failing lookup
    // falls back to the default four charts.
    let charts = DEFAULT_CHARTS;
    try {
        const config = await getMonitorConfig();
        if (config.charts.length) charts = config.charts;
    } catch {
        charts = DEFAULT_CHARTS;
    }

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">{t('title')}</h1>
                    <p className="page-sub">{t('sub')}</p>
                </div>
            </header>
            <MonitorWall initialCharts={charts} />
        </>
    );
}
