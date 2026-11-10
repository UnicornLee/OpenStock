import { Schema, model, models, type Document, type Model } from 'mongoose';
import { modelOn, type DbHandle } from '@/database/request-connection';

export interface MonitorChart {
    symbol: string;
    name: string;
}

export interface MonitorPublished {
    id: string;
    label: string;
}

export interface MonitorConfig extends Document {
    userId: string;
    charts: MonitorChart[];
    studies: string[];
    published: MonitorPublished[];
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
