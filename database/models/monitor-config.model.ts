import { Schema, model, models, type Document, type Model } from 'mongoose';
import { modelOn, type DbHandle } from '@/database/request-connection';

export interface MonitorChart {
    symbol: string;
    name: string;
    /** TradingView study ids enabled on this chart. */
    studies?: string[];
    /** Ids of the self-hosted Pine indicators enabled on this chart. */
    pineStudies?: string[];
}

export interface MonitorPublished {
    id: string;
    label: string;
}

export interface MonitorConfig extends Document {
    userId: string;
    charts: MonitorChart[];
    /** Wall-wide TradingView studies, applied to every chart that does not override them. */
    studies: string[];
    published: MonitorPublished[];
    /** Wall-wide Pine indicators, applied to every chart that does not override them. */
    pineStudies: string[];
    updatedAt: Date;
}

// The monitoring wall's layout: which charts are on it, which TradingView studies are enabled, and
// which of the user's own published scripts are registered. One row per user, so the wall follows
// the account across browsers and machines instead of living in one browser's localStorage.
const MonitorConfigSchema = new Schema<MonitorConfig>(
    {
        userId: { type: String, required: true, index: { unique: true } },
        charts: {
            type: [
                {
                    symbol: { type: String, required: true, uppercase: true, trim: true },
                    name: { type: String, required: true, trim: true },
                    studies: { type: [String], default: [] },
                    pineStudies: { type: [String], default: [] },
                },
            ],
            default: [],
        },
        studies: { type: [String], default: [] },
        published: {
            type: [
                {
                    id: { type: String, required: true, trim: true },
                    label: { type: String, required: true, trim: true },
                },
            ],
            default: [],
        },
        pineStudies: { type: [String], default: [] },
        updatedAt: { type: Date, default: Date.now },
    },
    { timestamps: { createdAt: true, updatedAt: true } }
);

// The unique index comes from the field's own index option, so it is declared there and not again here.


const compiledMonitorConfig: Model<MonitorConfig> =
    (models?.MonitorConfig as Model<MonitorConfig>) || model<MonitorConfig>('MonitorConfig', MonitorConfigSchema);

export const MonitorConfig: Model<MonitorConfig> = compiledMonitorConfig;

export function monitorConfigModel(db: DbHandle): Model<MonitorConfig> {
    return modelOn(db, 'MonitorConfig', MonitorConfigSchema, compiledMonitorConfig);
}
