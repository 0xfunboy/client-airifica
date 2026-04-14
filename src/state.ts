import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { TradeProposal } from "./types.ts";

export interface PacificaBindingRecord {
    walletAddress: string;
    pacificaAccount: string;
    agentWalletPublicKey: string;
    encryptedAgentWalletPrivateKey: string;
    builderCode: string;
    isActive: boolean;
    builderApprovedAt: number | null;
    agentBoundAt: number | null;
    createdAt: number;
    updatedAt: number;
}

export interface TradeProposalRecord {
    id: number;
    walletAddress: string;
    conversationId: string;
    proposal: TradeProposal;
    marketQuery?: string | null;
    executionVenue?: "pacifica" | "jupiter" | null;
    supportedOnPacifica?: boolean;
    supportedOnJupiter?: boolean;
    baseTokenAddress?: string | null;
    pairAddress?: string | null;
    maxLeverage?: number | null;
    status: "PROPOSED" | "APPROVED" | "EXECUTED" | "FAILED" | "REJECTED";
    errorMessage: string | null;
    orderId: string | null;
    executedMarginUsd?: number | null;
    executedLeverage?: number | null;
    executedNotionalUsd?: number | null;
    executedAt?: number | null;
    executionSource?: string | null;
    createdAt: number;
    updatedAt: number;
}

export interface AirificaUserRecord {
    walletAddress: string;
    firstSeenAt: number;
    lastSeenAt: number;
    verifiedAt: number | null;
    authCount: number;
    isAdmin: boolean;
    lastSource: string | null;
}

export interface AnalyticsCounterRecord {
    key: string;
    count: number;
    updatedAt: number;
}

export interface RuntimeHeartbeatRecord {
    name: string;
    lastSeenAt: number;
    meta: Record<string, unknown>;
}

export interface TelegramLinkCodeRecord {
    code: string;
    walletAddress: string;
    createdAt: number;
    expiresAt: number;
}

export interface TelegramLinkRecord {
    chatId: string;
    userId: string;
    walletAddress: string;
    username: string | null;
    firstName: string | null;
    alertsEnabled: boolean;
    conversationalEnabled: boolean;
    createdAt: number;
    updatedAt: number;
}

export interface TelegramNotificationRecord {
    id: number;
    walletAddress: string;
    chatId: string;
    kind: "TRADE_OPENED" | "POSITION_CLOSED";
    text: string;
    meta?: Record<string, unknown> | null;
    status: "PENDING" | "DELIVERED" | "FAILED";
    errorMessage: string | null;
    createdAt: number;
    updatedAt: number;
    deliveredAt: number | null;
}

export interface OnchainSpotWatchRecord {
    walletAddress: string;
    mintAddress: string;
    symbol: string | null;
    marketQuery: string | null;
    decimals: number | null;
    lastPriceUsd: number | null;
    lastValueUsd: number | null;
    lastSyncedAt: number | null;
    lastTradeAt: number | null;
    lastTxSignature: string | null;
    lastNotionalUsd: number | null;
    lastQuantity: number | null;
    costBasisUsd: number | null;
    realizedPnlUsd: number | null;
    createdAt: number;
    updatedAt: number;
}

export interface OnchainWalletSyncRecord {
    walletAddress: string;
    lastSyncedAt: number | null;
    itemCount: number;
    source: string | null;
    createdAt: number;
    updatedAt: number;
}

export interface TradeLedgerRecord {
    id: number;
    walletAddress: string;
    venue: "pacifica" | "jupiter";
    marketType: "perp" | "spot";
    symbol: string;
    side: "LONG" | "SHORT" | "BUY" | "SELL" | "CLOSE";
    quantity: number | null;
    notionalUsd: number | null;
    marginUsd: number | null;
    leverage: number | null;
    realizedPnlUsd: number | null;
    mintAddress: string | null;
    orderId: string | null;
    txSignature: string | null;
    proposalId: number | null;
    executionSource: string | null;
    note: string | null;
    createdAt: number;
    updatedAt: number;
}

interface AirificaStateShape {
    nextProposalId: number;
    nextTelegramNotificationId: number;
    nextTradeLedgerId: number;
    pacificaBindings: Record<string, PacificaBindingRecord>;
    proposals: Record<string, TradeProposalRecord>;
    users: Record<string, AirificaUserRecord>;
    analyticsCounters: Record<string, AnalyticsCounterRecord>;
    runtimeHeartbeats: Record<string, RuntimeHeartbeatRecord>;
    telegramLinkCodes: Record<string, TelegramLinkCodeRecord>;
    telegramLinks: Record<string, TelegramLinkRecord>;
    telegramNotifications: Record<string, TelegramNotificationRecord>;
    onchainSpotWatches: Record<string, OnchainSpotWatchRecord>;
    onchainWalletSyncs: Record<string, OnchainWalletSyncRecord>;
    tradeLedger: Record<string, TradeLedgerRecord>;
}

type SqliteRunResult = {
    changes: number;
    lastInsertRowid?: number | bigint;
};

type SqliteStatement<Row = Record<string, unknown>> = {
    get: (...params: unknown[]) => Row | undefined;
    all: (...params: unknown[]) => Row[];
    run: (...params: unknown[]) => SqliteRunResult;
};

type SqliteLikeDatabase = {
    exec: (sql: string) => unknown;
    prepare: <Row = Record<string, unknown>>(sql: string) => SqliteStatement<Row>;
    transaction: <T extends (...args: any[]) => any>(fn: T) => T;
};

type LegacyStatePayload = Partial<AirificaStateShape>;

const AIRIFICA_STATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS airifica_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS airifica_pacifica_bindings (
    wallet_address TEXT PRIMARY KEY,
    pacifica_account TEXT NOT NULL,
    agent_wallet_public_key TEXT NOT NULL,
    encrypted_agent_wallet_private_key TEXT NOT NULL,
    builder_code TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    builder_approved_at INTEGER,
    agent_bound_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS airifica_trade_proposals (
    id INTEGER PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    proposal_json TEXT NOT NULL,
    market_query TEXT,
    execution_venue TEXT,
    supported_on_pacifica INTEGER NOT NULL DEFAULT 0,
    supported_on_jupiter INTEGER NOT NULL DEFAULT 0,
    base_token_address TEXT,
    pair_address TEXT,
    max_leverage REAL,
    status TEXT NOT NULL,
    error_message TEXT,
    order_id TEXT,
    executed_margin_usd REAL,
    executed_leverage REAL,
    executed_notional_usd REAL,
    executed_at INTEGER,
    execution_source TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS airifica_trade_proposals_wallet_updated_idx
    ON airifica_trade_proposals (wallet_address, updated_at DESC);
CREATE INDEX IF NOT EXISTS airifica_trade_proposals_status_idx
    ON airifica_trade_proposals (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS airifica_users (
    wallet_address TEXT PRIMARY KEY,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    verified_at INTEGER,
    auth_count INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    last_source TEXT
);

CREATE INDEX IF NOT EXISTS airifica_users_last_seen_idx
    ON airifica_users (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS airifica_analytics_counters (
    key TEXT PRIMARY KEY,
    count REAL NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS airifica_analytics_counters_updated_idx
    ON airifica_analytics_counters (updated_at DESC);

CREATE TABLE IF NOT EXISTS airifica_runtime_heartbeats (
    name TEXT PRIMARY KEY,
    last_seen_at INTEGER NOT NULL,
    meta_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS airifica_telegram_link_codes (
    code TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS airifica_telegram_link_codes_wallet_idx
    ON airifica_telegram_link_codes (wallet_address, expires_at DESC);

CREATE TABLE IF NOT EXISTS airifica_telegram_links (
    chat_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    username TEXT,
    first_name TEXT,
    alerts_enabled INTEGER NOT NULL DEFAULT 1,
    conversational_enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS airifica_telegram_links_wallet_idx
    ON airifica_telegram_links (wallet_address, updated_at DESC);

CREATE TABLE IF NOT EXISTS airifica_telegram_notifications (
    id INTEGER PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    meta_json TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    delivered_at INTEGER
);

CREATE INDEX IF NOT EXISTS airifica_telegram_notifications_status_idx
    ON airifica_telegram_notifications (status, created_at ASC);
CREATE INDEX IF NOT EXISTS airifica_telegram_notifications_wallet_idx
    ON airifica_telegram_notifications (wallet_address, created_at DESC);

CREATE TABLE IF NOT EXISTS airifica_onchain_spot_watches (
    wallet_address TEXT NOT NULL,
    mint_address TEXT NOT NULL,
    symbol TEXT,
    market_query TEXT,
    decimals INTEGER,
    last_price_usd REAL,
    last_value_usd REAL,
    last_synced_at INTEGER,
    last_trade_at INTEGER,
    last_tx_signature TEXT,
    last_notional_usd REAL,
    last_quantity REAL,
    cost_basis_usd REAL,
    realized_pnl_usd REAL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (wallet_address, mint_address)
);

CREATE INDEX IF NOT EXISTS airifica_onchain_spot_watches_wallet_idx
    ON airifica_onchain_spot_watches (wallet_address, updated_at DESC);

CREATE TABLE IF NOT EXISTS airifica_onchain_wallet_syncs (
    wallet_address TEXT PRIMARY KEY,
    last_synced_at INTEGER,
    item_count INTEGER NOT NULL DEFAULT 0,
    source TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS airifica_trade_ledger (
    id INTEGER PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    venue TEXT NOT NULL,
    market_type TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    quantity REAL,
    notional_usd REAL,
    margin_usd REAL,
    leverage REAL,
    realized_pnl_usd REAL,
    mint_address TEXT,
    order_id TEXT,
    tx_signature TEXT,
    proposal_id INTEGER,
    execution_source TEXT,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS airifica_trade_ledger_wallet_idx
    ON airifica_trade_ledger (wallet_address, created_at DESC);
CREATE INDEX IF NOT EXISTS airifica_trade_ledger_proposal_idx
    ON airifica_trade_ledger (proposal_id);
`;

function resolveLegacyStateFilePath() {
    const configuredDir = (process.env.AIRIFICA_DATA_DIR || process.env.AIRI3_DATA_DIR || "").trim();
    const baseDir = configuredDir
        ? path.resolve(configuredDir)
        : path.resolve(process.cwd(), "data", "airifica");

    return path.join(baseDir, "airifica-state.json");
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
    if (typeof value !== "string" || !value.trim())
        return fallback;
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

function toJson(value: unknown) {
    return JSON.stringify(value ?? null);
}

function numberOrNull(value: unknown) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function integerOrNull(value: unknown) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function stringOrNull(value: unknown) {
    const normalized = String(value ?? "").trim();
    return normalized ? normalized : null;
}

function boolFromDb(value: unknown) {
    return Boolean(Number(value || 0));
}

function boolToDb(value: boolean | undefined | null) {
    return value ? 1 : 0;
}

function ensureSqliteDatabase(db: unknown): SqliteLikeDatabase {
    if (
        db
        && typeof db === "object"
        && typeof (db as SqliteLikeDatabase).prepare === "function"
        && typeof (db as SqliteLikeDatabase).exec === "function"
        && typeof (db as SqliteLikeDatabase).transaction === "function"
    ) {
        return db as SqliteLikeDatabase;
    }

    throw new Error("Airifica state store requires a SQLite database handle");
}

type PacificaBindingRow = {
    wallet_address: string;
    pacifica_account: string;
    agent_wallet_public_key: string;
    encrypted_agent_wallet_private_key: string;
    builder_code: string;
    is_active: number;
    builder_approved_at: number | null;
    agent_bound_at: number | null;
    created_at: number;
    updated_at: number;
};

type TradeProposalRow = {
    id: number;
    wallet_address: string;
    conversation_id: string;
    proposal_json: string;
    market_query: string | null;
    execution_venue: "pacifica" | "jupiter" | null;
    supported_on_pacifica: number;
    supported_on_jupiter: number;
    base_token_address: string | null;
    pair_address: string | null;
    max_leverage: number | null;
    status: TradeProposalRecord["status"];
    error_message: string | null;
    order_id: string | null;
    executed_margin_usd: number | null;
    executed_leverage: number | null;
    executed_notional_usd: number | null;
    executed_at: number | null;
    execution_source: string | null;
    created_at: number;
    updated_at: number;
};

type AirificaUserRow = {
    wallet_address: string;
    first_seen_at: number;
    last_seen_at: number;
    verified_at: number | null;
    auth_count: number;
    is_admin: number;
    last_source: string | null;
};

type AnalyticsCounterRow = {
    key: string;
    count: number;
    updated_at: number;
};

type RuntimeHeartbeatRow = {
    name: string;
    last_seen_at: number;
    meta_json: string;
};

type TelegramLinkCodeRow = {
    code: string;
    wallet_address: string;
    created_at: number;
    expires_at: number;
};

type TelegramLinkRow = {
    chat_id: string;
    user_id: string;
    wallet_address: string;
    username: string | null;
    first_name: string | null;
    alerts_enabled: number;
    conversational_enabled: number;
    created_at: number;
    updated_at: number;
};

type TelegramNotificationRow = {
    id: number;
    wallet_address: string;
    chat_id: string;
    kind: TelegramNotificationRecord["kind"];
    text: string;
    meta_json: string | null;
    status: TelegramNotificationRecord["status"];
    error_message: string | null;
    created_at: number;
    updated_at: number;
    delivered_at: number | null;
};

type OnchainSpotWatchRow = {
    wallet_address: string;
    mint_address: string;
    symbol: string | null;
    market_query: string | null;
    decimals: number | null;
    last_price_usd: number | null;
    last_value_usd: number | null;
    last_synced_at: number | null;
    last_trade_at: number | null;
    last_tx_signature: string | null;
    last_notional_usd: number | null;
    last_quantity: number | null;
    cost_basis_usd: number | null;
    realized_pnl_usd: number | null;
    created_at: number;
    updated_at: number;
};

type OnchainWalletSyncRow = {
    wallet_address: string;
    last_synced_at: number | null;
    item_count: number;
    source: string | null;
    created_at: number;
    updated_at: number;
};

type TradeLedgerRow = {
    id: number;
    wallet_address: string;
    venue: TradeLedgerRecord["venue"];
    market_type: TradeLedgerRecord["marketType"];
    symbol: string;
    side: TradeLedgerRecord["side"];
    quantity: number | null;
    notional_usd: number | null;
    margin_usd: number | null;
    leverage: number | null;
    realized_pnl_usd: number | null;
    mint_address: string | null;
    order_id: string | null;
    tx_signature: string | null;
    proposal_id: number | null;
    execution_source: string | null;
    note: string | null;
    created_at: number;
    updated_at: number;
};

function mapBindingRow(row: PacificaBindingRow | undefined | null) {
    if (!row)
        return null;
    return {
        walletAddress: row.wallet_address,
        pacificaAccount: row.pacifica_account,
        agentWalletPublicKey: row.agent_wallet_public_key,
        encryptedAgentWalletPrivateKey: row.encrypted_agent_wallet_private_key,
        builderCode: row.builder_code,
        isActive: boolFromDb(row.is_active),
        builderApprovedAt: integerOrNull(row.builder_approved_at),
        agentBoundAt: integerOrNull(row.agent_bound_at),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
    } satisfies PacificaBindingRecord;
}

function mapProposalRow(row: TradeProposalRow | undefined | null) {
    if (!row)
        return null;
    return {
        id: Number(row.id),
        walletAddress: row.wallet_address,
        conversationId: row.conversation_id,
        proposal: parseJsonValue<TradeProposal>(row.proposal_json, {} as TradeProposal),
        marketQuery: stringOrNull(row.market_query),
        executionVenue: row.execution_venue || null,
        supportedOnPacifica: boolFromDb(row.supported_on_pacifica),
        supportedOnJupiter: boolFromDb(row.supported_on_jupiter),
        baseTokenAddress: stringOrNull(row.base_token_address),
        pairAddress: stringOrNull(row.pair_address),
        maxLeverage: numberOrNull(row.max_leverage),
        status: row.status,
        errorMessage: stringOrNull(row.error_message),
        orderId: stringOrNull(row.order_id),
        executedMarginUsd: numberOrNull(row.executed_margin_usd),
        executedLeverage: numberOrNull(row.executed_leverage),
        executedNotionalUsd: numberOrNull(row.executed_notional_usd),
        executedAt: integerOrNull(row.executed_at),
        executionSource: stringOrNull(row.execution_source),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
    } satisfies TradeProposalRecord;
}

function mapUserRow(row: AirificaUserRow | undefined | null) {
    if (!row)
        return null;
    return {
        walletAddress: row.wallet_address,
        firstSeenAt: Number(row.first_seen_at),
        lastSeenAt: Number(row.last_seen_at),
        verifiedAt: integerOrNull(row.verified_at),
        authCount: Number(row.auth_count || 0),
        isAdmin: boolFromDb(row.is_admin),
        lastSource: stringOrNull(row.last_source),
    } satisfies AirificaUserRecord;
}

function mapCounterRow(row: AnalyticsCounterRow | undefined | null) {
    if (!row)
        return null;
    return {
        key: row.key,
        count: Number(row.count || 0),
        updatedAt: Number(row.updated_at),
    } satisfies AnalyticsCounterRecord;
}

function mapHeartbeatRow(row: RuntimeHeartbeatRow | undefined | null) {
    if (!row)
        return null;
    return {
        name: row.name,
        lastSeenAt: Number(row.last_seen_at),
        meta: parseJsonValue<Record<string, unknown>>(row.meta_json, {}),
    } satisfies RuntimeHeartbeatRecord;
}

function mapTelegramLinkCodeRow(row: TelegramLinkCodeRow | undefined | null) {
    if (!row)
        return null;
    return {
        code: row.code,
        walletAddress: row.wallet_address,
        createdAt: Number(row.created_at),
        expiresAt: Number(row.expires_at),
    } satisfies TelegramLinkCodeRecord;
}

function mapTelegramLinkRow(row: TelegramLinkRow | undefined | null) {
    if (!row)
        return null;
    return {
        chatId: row.chat_id,
        userId: row.user_id,
        walletAddress: row.wallet_address,
        username: stringOrNull(row.username),
        firstName: stringOrNull(row.first_name),
        alertsEnabled: boolFromDb(row.alerts_enabled),
        conversationalEnabled: boolFromDb(row.conversational_enabled),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
    } satisfies TelegramLinkRecord;
}

function mapTelegramNotificationRow(row: TelegramNotificationRow | undefined | null) {
    if (!row)
        return null;
    return {
        id: Number(row.id),
        walletAddress: row.wallet_address,
        chatId: row.chat_id,
        kind: row.kind,
        text: row.text,
        meta: row.meta_json ? parseJsonValue<Record<string, unknown>>(row.meta_json, {}) : null,
        status: row.status,
        errorMessage: stringOrNull(row.error_message),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        deliveredAt: integerOrNull(row.delivered_at),
    } satisfies TelegramNotificationRecord;
}

function mapOnchainSpotWatchRow(row: OnchainSpotWatchRow | undefined | null) {
    if (!row)
        return null;
    return {
        walletAddress: row.wallet_address,
        mintAddress: row.mint_address,
        symbol: stringOrNull(row.symbol),
        marketQuery: stringOrNull(row.market_query),
        decimals: integerOrNull(row.decimals),
        lastPriceUsd: numberOrNull(row.last_price_usd),
        lastValueUsd: numberOrNull(row.last_value_usd),
        lastSyncedAt: integerOrNull(row.last_synced_at),
        lastTradeAt: integerOrNull(row.last_trade_at),
        lastTxSignature: stringOrNull(row.last_tx_signature),
        lastNotionalUsd: numberOrNull(row.last_notional_usd),
        lastQuantity: numberOrNull(row.last_quantity),
        costBasisUsd: numberOrNull(row.cost_basis_usd),
        realizedPnlUsd: numberOrNull(row.realized_pnl_usd),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
    } satisfies OnchainSpotWatchRecord;
}

function mapOnchainWalletSyncRow(row: OnchainWalletSyncRow | undefined | null) {
    if (!row)
        return null;
    return {
        walletAddress: row.wallet_address,
        lastSyncedAt: integerOrNull(row.last_synced_at),
        itemCount: Number(row.item_count || 0),
        source: stringOrNull(row.source),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
    } satisfies OnchainWalletSyncRecord;
}

function mapTradeLedgerRow(row: TradeLedgerRow | undefined | null) {
    if (!row)
        return null;
    return {
        id: Number(row.id),
        walletAddress: row.wallet_address,
        venue: row.venue,
        marketType: row.market_type,
        symbol: row.symbol,
        side: row.side,
        quantity: numberOrNull(row.quantity),
        notionalUsd: numberOrNull(row.notional_usd),
        marginUsd: numberOrNull(row.margin_usd),
        leverage: numberOrNull(row.leverage),
        realizedPnlUsd: numberOrNull(row.realized_pnl_usd),
        mintAddress: stringOrNull(row.mint_address),
        orderId: stringOrNull(row.order_id),
        txSignature: stringOrNull(row.tx_signature),
        proposalId: integerOrNull(row.proposal_id),
        executionSource: stringOrNull(row.execution_source),
        note: stringOrNull(row.note),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
    } satisfies TradeLedgerRecord;
}

export class AirificaStateStore {
    private readonly db: SqliteLikeDatabase;
    private readonly legacyStateFilePath = resolveLegacyStateFilePath();

    constructor(db: unknown) {
        this.db = ensureSqliteDatabase(db);
        this.initializeSchema();
        this.maybeImportLegacyState();
    }

    private initializeSchema() {
        this.db.exec(AIRIFICA_STATE_SCHEMA);
        this.setMeta("schema_version", "2");
    }

    private getMeta(key: string) {
        const row = this.db
            .prepare<{ value: string }>("SELECT value FROM airifica_meta WHERE key = ?")
            .get(key);
        return row?.value ?? null;
    }

    private setMeta(key: string, value: string) {
        this.db
            .prepare(
                `
                INSERT INTO airifica_meta (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                `,
            )
            .run(key, value, Date.now());
    }

    private hasPersistedState() {
        const tables = [
            "airifica_pacifica_bindings",
            "airifica_trade_proposals",
            "airifica_users",
            "airifica_telegram_links",
            "airifica_trade_ledger",
            "airifica_onchain_spot_watches",
        ] as const;

        return tables.some((table) => Boolean(this.db.prepare(`SELECT 1 AS value FROM ${table} LIMIT 1`).get()));
    }

    private loadLegacyStateFile() {
        if (!fs.existsSync(this.legacyStateFilePath))
            return null;

        try {
            const raw = fs.readFileSync(this.legacyStateFilePath, "utf8");
            return raw ? JSON.parse(raw) as LegacyStatePayload : null;
        } catch {
            return null;
        }
    }

    private markLegacyStateMigrated() {
        try {
            const migratedPath = `${this.legacyStateFilePath}.migrated-${Date.now()}`;
            fs.renameSync(this.legacyStateFilePath, migratedPath);
            this.setMeta("legacy_state_backup_path", migratedPath);
        } catch {
            // Keep the backup step best-effort so a successful import is not rolled back on rename issues.
        }
    }

    private maybeImportLegacyState() {
        if (this.getMeta("legacy_state_imported_at"))
            return;
        if (this.hasPersistedState())
            return;

        const legacyState = this.loadLegacyStateFile();
        if (!legacyState)
            return;

        const importTransaction = this.db.transaction(() => {
            for (const record of Object.values(legacyState.pacificaBindings ?? {})) {
                this.db.prepare(
                    `
                    INSERT OR REPLACE INTO airifica_pacifica_bindings (
                        wallet_address,
                        pacifica_account,
                        agent_wallet_public_key,
                        encrypted_agent_wallet_private_key,
                        builder_code,
                        is_active,
                        builder_approved_at,
                        agent_bound_at,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                ).run(
                    record.walletAddress,
                    record.pacificaAccount,
                    record.agentWalletPublicKey,
                    record.encryptedAgentWalletPrivateKey,
                    record.builderCode,
                    boolToDb(record.isActive),
                    integerOrNull(record.builderApprovedAt),
                    integerOrNull(record.agentBoundAt),
                    Number(record.createdAt),
                    Number(record.updatedAt),
                );
            }

            for (const record of Object.values(legacyState.proposals ?? {})) {
                this.db.prepare(
                    `
                    INSERT OR REPLACE INTO airifica_trade_proposals (
                        id,
                        wallet_address,
                        conversation_id,
                        proposal_json,
                        market_query,
                        execution_venue,
                        supported_on_pacifica,
                        supported_on_jupiter,
                        base_token_address,
                        pair_address,
                        max_leverage,
                        status,
                        error_message,
                        order_id,
                        executed_margin_usd,
                        executed_leverage,
                        executed_notional_usd,
                        executed_at,
                        execution_source,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                ).run(
                    Number(record.id),
                    record.walletAddress,
                    record.conversationId,
                    toJson(record.proposal),
                    stringOrNull(record.marketQuery),
                    stringOrNull(record.executionVenue),
                    boolToDb(record.supportedOnPacifica),
                    boolToDb(record.supportedOnJupiter),
                    stringOrNull(record.baseTokenAddress),
                    stringOrNull(record.pairAddress),
                    numberOrNull(record.maxLeverage),
                    record.status,
                    stringOrNull(record.errorMessage),
                    stringOrNull(record.orderId),
                    numberOrNull(record.executedMarginUsd),
                    numberOrNull(record.executedLeverage),
                    numberOrNull(record.executedNotionalUsd),
                    integerOrNull(record.executedAt),
                    stringOrNull(record.executionSource),
                    Number(record.createdAt),
                    Number(record.updatedAt),
                );
            }

            for (const record of Object.values(legacyState.users ?? {})) {
                this.db.prepare(
                    `
                    INSERT OR REPLACE INTO airifica_users (
                        wallet_address,
                        first_seen_at,
                        last_seen_at,
                        verified_at,
                        auth_count,
                        is_admin,
                        last_source
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    `,
                ).run(
                    record.walletAddress,
                    Number(record.firstSeenAt),
                    Number(record.lastSeenAt),
                    integerOrNull(record.verifiedAt),
                    Number(record.authCount || 0),
                    boolToDb(record.isAdmin),
                    stringOrNull(record.lastSource),
                );
            }

            for (const record of Object.values(legacyState.analyticsCounters ?? {})) {
                this.db.prepare(
                    `
                    INSERT OR REPLACE INTO airifica_analytics_counters (
                        key,
                        count,
                        updated_at
                    ) VALUES (?, ?, ?)
                    `,
                ).run(
                    record.key,
                    Number(record.count || 0),
                    Number(record.updatedAt),
                );
            }

            for (const record of Object.values(legacyState.runtimeHeartbeats ?? {})) {
                this.db.prepare(
                    `
                    INSERT OR REPLACE INTO airifica_runtime_heartbeats (
                        name,
                        last_seen_at,
                        meta_json
                    ) VALUES (?, ?, ?)
                    `,
                ).run(
                    record.name,
                    Number(record.lastSeenAt),
                    toJson(record.meta ?? {}),
                );
            }

            for (const record of Object.values(legacyState.telegramLinkCodes ?? {})) {
                this.db.prepare(
                    `
                    INSERT OR REPLACE INTO airifica_telegram_link_codes (
                        code,
                        wallet_address,
                        created_at,
                        expires_at
                    ) VALUES (?, ?, ?, ?)
                    `,
                ).run(
                    record.code,
                    record.walletAddress,
                    Number(record.createdAt),
                    Number(record.expiresAt),
                );
            }

            for (const record of Object.values(legacyState.telegramLinks ?? {})) {
                this.db.prepare(
                    `
                    INSERT OR REPLACE INTO airifica_telegram_links (
                        chat_id,
                        user_id,
                        wallet_address,
                        username,
                        first_name,
                        alerts_enabled,
                        conversational_enabled,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                ).run(
                    record.chatId,
                    record.userId,
                    record.walletAddress,
                    stringOrNull(record.username),
                    stringOrNull(record.firstName),
                    boolToDb(record.alertsEnabled),
                    boolToDb(record.conversationalEnabled),
                    Number(record.createdAt),
                    Number(record.updatedAt),
                );
            }

            for (const record of Object.values(legacyState.telegramNotifications ?? {})) {
                this.db.prepare(
                    `
                    INSERT OR REPLACE INTO airifica_telegram_notifications (
                        id,
                        wallet_address,
                        chat_id,
                        kind,
                        text,
                        meta_json,
                        status,
                        error_message,
                        created_at,
                        updated_at,
                        delivered_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                ).run(
                    Number(record.id),
                    record.walletAddress,
                    record.chatId,
                    record.kind,
                    record.text,
                    record.meta ? toJson(record.meta) : null,
                    record.status,
                    stringOrNull(record.errorMessage),
                    Number(record.createdAt),
                    Number(record.updatedAt),
                    integerOrNull(record.deliveredAt),
                );
            }

            for (const record of Object.values(legacyState.onchainSpotWatches ?? {})) {
                this.db.prepare(
                    `
                    INSERT OR REPLACE INTO airifica_onchain_spot_watches (
                        wallet_address,
                        mint_address,
                        symbol,
                        market_query,
                        decimals,
                        last_price_usd,
                        last_value_usd,
                        last_synced_at,
                        last_trade_at,
                        last_tx_signature,
                        last_notional_usd,
                        last_quantity,
                        cost_basis_usd,
                        realized_pnl_usd,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                ).run(
                    record.walletAddress,
                    record.mintAddress,
                    stringOrNull(record.symbol),
                    stringOrNull(record.marketQuery),
                    integerOrNull(record.decimals),
                    numberOrNull(record.lastPriceUsd),
                    numberOrNull(record.lastValueUsd),
                    integerOrNull(record.lastSyncedAt),
                    integerOrNull(record.lastTradeAt),
                    stringOrNull(record.lastTxSignature),
                    numberOrNull(record.lastNotionalUsd),
                    numberOrNull(record.lastQuantity),
                    numberOrNull(record.costBasisUsd),
                    numberOrNull(record.realizedPnlUsd),
                    Number(record.createdAt),
                    Number(record.updatedAt),
                );
            }

            for (const record of Object.values(legacyState.onchainWalletSyncs ?? {})) {
                this.db.prepare(
                    `
                    INSERT OR REPLACE INTO airifica_onchain_wallet_syncs (
                        wallet_address,
                        last_synced_at,
                        item_count,
                        source,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    `,
                ).run(
                    record.walletAddress,
                    integerOrNull(record.lastSyncedAt),
                    Number(record.itemCount || 0),
                    stringOrNull(record.source),
                    Number(record.createdAt),
                    Number(record.updatedAt),
                );
            }

            for (const record of Object.values(legacyState.tradeLedger ?? {})) {
                this.db.prepare(
                    `
                    INSERT OR REPLACE INTO airifica_trade_ledger (
                        id,
                        wallet_address,
                        venue,
                        market_type,
                        symbol,
                        side,
                        quantity,
                        notional_usd,
                        margin_usd,
                        leverage,
                        realized_pnl_usd,
                        mint_address,
                        order_id,
                        tx_signature,
                        proposal_id,
                        execution_source,
                        note,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                ).run(
                    Number(record.id),
                    record.walletAddress,
                    record.venue,
                    record.marketType,
                    record.symbol,
                    record.side,
                    numberOrNull(record.quantity),
                    numberOrNull(record.notionalUsd),
                    numberOrNull(record.marginUsd),
                    numberOrNull(record.leverage),
                    numberOrNull(record.realizedPnlUsd),
                    stringOrNull(record.mintAddress),
                    stringOrNull(record.orderId),
                    stringOrNull(record.txSignature),
                    integerOrNull(record.proposalId),
                    stringOrNull(record.executionSource),
                    stringOrNull(record.note),
                    Number(record.createdAt),
                    Number(record.updatedAt),
                );
            }
        });

        importTransaction();
        this.setMeta("legacy_state_imported_at", String(Date.now()));
        this.setMeta("legacy_state_path", this.legacyStateFilePath);
        this.markLegacyStateMigrated();
    }

    getBinding(walletAddress: string) {
        return mapBindingRow(
            this.db
                .prepare<PacificaBindingRow>("SELECT * FROM airifica_pacifica_bindings WHERE wallet_address = ?")
                .get(walletAddress),
        );
    }

    listBindings() {
        return this.db
            .prepare<PacificaBindingRow>("SELECT * FROM airifica_pacifica_bindings ORDER BY updated_at DESC")
            .all()
            .map(mapBindingRow)
            .filter((record): record is PacificaBindingRecord => Boolean(record));
    }

    upsertBinding(walletAddress: string, patch: Omit<PacificaBindingRecord, "walletAddress" | "createdAt" | "updatedAt">) {
        const existing = this.getBinding(walletAddress);
        const now = Date.now();
        const next: PacificaBindingRecord = {
            walletAddress,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            ...existing,
            ...patch,
        };
        this.db.prepare(
            `
            INSERT INTO airifica_pacifica_bindings (
                wallet_address,
                pacifica_account,
                agent_wallet_public_key,
                encrypted_agent_wallet_private_key,
                builder_code,
                is_active,
                builder_approved_at,
                agent_bound_at,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(wallet_address) DO UPDATE SET
                pacifica_account = excluded.pacifica_account,
                agent_wallet_public_key = excluded.agent_wallet_public_key,
                encrypted_agent_wallet_private_key = excluded.encrypted_agent_wallet_private_key,
                builder_code = excluded.builder_code,
                is_active = excluded.is_active,
                builder_approved_at = excluded.builder_approved_at,
                agent_bound_at = excluded.agent_bound_at,
                updated_at = excluded.updated_at
            `,
        ).run(
            next.walletAddress,
            next.pacificaAccount,
            next.agentWalletPublicKey,
            next.encryptedAgentWalletPrivateKey,
            next.builderCode,
            boolToDb(next.isActive),
            integerOrNull(next.builderApprovedAt),
            integerOrNull(next.agentBoundAt),
            Number(next.createdAt),
            Number(next.updatedAt),
        );
        return next;
    }

    updateBinding(walletAddress: string, patch: Partial<PacificaBindingRecord>) {
        const existing = this.getBinding(walletAddress);
        if (!existing)
            return null;

        return this.upsertBinding(walletAddress, {
            pacificaAccount: patch.pacificaAccount ?? existing.pacificaAccount,
            agentWalletPublicKey: patch.agentWalletPublicKey ?? existing.agentWalletPublicKey,
            encryptedAgentWalletPrivateKey: patch.encryptedAgentWalletPrivateKey ?? existing.encryptedAgentWalletPrivateKey,
            builderCode: patch.builderCode ?? existing.builderCode,
            isActive: typeof patch.isActive === "boolean" ? patch.isActive : existing.isActive,
            builderApprovedAt: patch.builderApprovedAt ?? existing.builderApprovedAt,
            agentBoundAt: patch.agentBoundAt ?? existing.agentBoundAt,
        });
    }

    createProposal(
        walletAddress: string,
        conversationId: string,
        proposal: TradeProposal,
        options?: Partial<Pick<
            TradeProposalRecord,
            "marketQuery" | "executionVenue" | "supportedOnPacifica" | "supportedOnJupiter" | "baseTokenAddress" | "pairAddress" | "maxLeverage"
        >>,
    ) {
        const now = Date.now();
        const result = this.db.prepare(
            `
            INSERT INTO airifica_trade_proposals (
                wallet_address,
                conversation_id,
                proposal_json,
                market_query,
                execution_venue,
                supported_on_pacifica,
                supported_on_jupiter,
                base_token_address,
                pair_address,
                max_leverage,
                status,
                error_message,
                order_id,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROPOSED', NULL, NULL, ?, ?)
            `,
        ).run(
            walletAddress,
            conversationId,
            toJson(proposal),
            stringOrNull(options?.marketQuery),
            stringOrNull(options?.executionVenue),
            boolToDb(options?.supportedOnPacifica),
            boolToDb(options?.supportedOnJupiter),
            stringOrNull(options?.baseTokenAddress),
            stringOrNull(options?.pairAddress),
            numberOrNull(options?.maxLeverage),
            now,
            now,
        );
        const id = Number(result.lastInsertRowid);
        return this.getProposal(id)!;
    }

    getProposal(id: number) {
        return mapProposalRow(
            this.db
                .prepare<TradeProposalRow>("SELECT * FROM airifica_trade_proposals WHERE id = ?")
                .get(id),
        );
    }

    listProposals() {
        return this.db
            .prepare<TradeProposalRow>("SELECT * FROM airifica_trade_proposals ORDER BY updated_at DESC")
            .all()
            .map(mapProposalRow)
            .filter((record): record is TradeProposalRecord => Boolean(record));
    }

    updateProposal(id: number, patch: Partial<TradeProposalRecord>) {
        const existing = this.getProposal(id);
        if (!existing)
            return null;

        const next: TradeProposalRecord = {
            ...existing,
            ...patch,
            updatedAt: Date.now(),
        };

        this.db.prepare(
            `
            UPDATE airifica_trade_proposals
            SET wallet_address = ?,
                conversation_id = ?,
                proposal_json = ?,
                market_query = ?,
                execution_venue = ?,
                supported_on_pacifica = ?,
                supported_on_jupiter = ?,
                base_token_address = ?,
                pair_address = ?,
                max_leverage = ?,
                status = ?,
                error_message = ?,
                order_id = ?,
                executed_margin_usd = ?,
                executed_leverage = ?,
                executed_notional_usd = ?,
                executed_at = ?,
                execution_source = ?,
                created_at = ?,
                updated_at = ?
            WHERE id = ?
            `,
        ).run(
            next.walletAddress,
            next.conversationId,
            toJson(next.proposal),
            stringOrNull(next.marketQuery),
            stringOrNull(next.executionVenue),
            boolToDb(next.supportedOnPacifica),
            boolToDb(next.supportedOnJupiter),
            stringOrNull(next.baseTokenAddress),
            stringOrNull(next.pairAddress),
            numberOrNull(next.maxLeverage),
            next.status,
            stringOrNull(next.errorMessage),
            stringOrNull(next.orderId),
            numberOrNull(next.executedMarginUsd),
            numberOrNull(next.executedLeverage),
            numberOrNull(next.executedNotionalUsd),
            integerOrNull(next.executedAt),
            stringOrNull(next.executionSource),
            Number(next.createdAt),
            Number(next.updatedAt),
            id,
        );

        return next;
    }

    getLatestExecutedProposalForWallet(walletAddress: string) {
        return mapProposalRow(
            this.db.prepare<TradeProposalRow>(
                `
                SELECT * FROM airifica_trade_proposals
                WHERE wallet_address = ? AND status = 'EXECUTED'
                ORDER BY updated_at DESC
                LIMIT 1
                `,
            ).get(walletAddress),
        );
    }

    touchUser(
        walletAddress: string,
        options?: {
            verified?: boolean;
            isAdmin?: boolean;
            source?: string | null;
        },
    ) {
        const now = Date.now();
        const existing = this.getUser(walletAddress);
        const next: AirificaUserRecord = {
            walletAddress,
            firstSeenAt: existing?.firstSeenAt || now,
            lastSeenAt: now,
            verifiedAt: options?.verified ? (existing?.verifiedAt || now) : (existing?.verifiedAt || null),
            authCount: options?.verified ? Number(existing?.authCount || 0) + 1 : Number(existing?.authCount || 0),
            isAdmin: typeof options?.isAdmin === "boolean" ? options.isAdmin : Boolean(existing?.isAdmin),
            lastSource: options?.source?.trim() || existing?.lastSource || null,
        };

        this.db.prepare(
            `
            INSERT INTO airifica_users (
                wallet_address,
                first_seen_at,
                last_seen_at,
                verified_at,
                auth_count,
                is_admin,
                last_source
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(wallet_address) DO UPDATE SET
                last_seen_at = excluded.last_seen_at,
                verified_at = excluded.verified_at,
                auth_count = excluded.auth_count,
                is_admin = excluded.is_admin,
                last_source = excluded.last_source
            `,
        ).run(
            next.walletAddress,
            Number(next.firstSeenAt),
            Number(next.lastSeenAt),
            integerOrNull(next.verifiedAt),
            Number(next.authCount || 0),
            boolToDb(next.isAdmin),
            stringOrNull(next.lastSource),
        );

        return next;
    }

    getUser(walletAddress: string) {
        return mapUserRow(
            this.db.prepare<AirificaUserRow>("SELECT * FROM airifica_users WHERE wallet_address = ?").get(walletAddress),
        );
    }

    listUsers() {
        return this.db
            .prepare<AirificaUserRow>("SELECT * FROM airifica_users ORDER BY last_seen_at DESC")
            .all()
            .map(mapUserRow)
            .filter((record): record is AirificaUserRecord => Boolean(record));
    }

    incrementCounter(prefix: string, key: string, amount = 1) {
        const normalizedPrefix = String(prefix || "").trim().toLowerCase();
        const normalizedKey = String(key || "").trim();
        if (!normalizedPrefix || !normalizedKey)
            return null;

        const compositeKey = `${normalizedPrefix}:${normalizedKey}`;
        const existing = this.db.prepare<AnalyticsCounterRow>(
            "SELECT * FROM airifica_analytics_counters WHERE key = ?",
        ).get(compositeKey);
        const nextCount = Number(existing?.count || 0) + amount;
        const updatedAt = Date.now();
        this.db.prepare(
            `
            INSERT INTO airifica_analytics_counters (key, count, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                count = excluded.count,
                updated_at = excluded.updated_at
            `,
        ).run(compositeKey, nextCount, updatedAt);
        return {
            key: compositeKey,
            count: nextCount,
            updatedAt,
        } satisfies AnalyticsCounterRecord;
    }

    listCounters(prefix?: string) {
        if (prefix?.trim()) {
            return this.db
                .prepare<AnalyticsCounterRow>(
                    `
                    SELECT * FROM airifica_analytics_counters
                    WHERE key LIKE ?
                    ORDER BY count DESC, updated_at DESC
                    `,
                )
                .all(`${prefix.trim().toLowerCase()}:%`)
                .map(mapCounterRow)
                .filter((record): record is AnalyticsCounterRecord => Boolean(record));
        }

        return this.db
            .prepare<AnalyticsCounterRow>("SELECT * FROM airifica_analytics_counters ORDER BY count DESC, updated_at DESC")
            .all()
            .map(mapCounterRow)
            .filter((record): record is AnalyticsCounterRecord => Boolean(record));
    }

    updateRuntimeHeartbeat(name: string, meta?: Record<string, unknown>) {
        const normalizedName = String(name || "").trim().toLowerCase();
        if (!normalizedName)
            return null;

        const next: RuntimeHeartbeatRecord = {
            name: normalizedName,
            lastSeenAt: Date.now(),
            meta: meta && typeof meta === "object" ? meta : {},
        };

        this.db.prepare(
            `
            INSERT INTO airifica_runtime_heartbeats (name, last_seen_at, meta_json)
            VALUES (?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                last_seen_at = excluded.last_seen_at,
                meta_json = excluded.meta_json
            `,
        ).run(next.name, Number(next.lastSeenAt), toJson(next.meta));

        return next;
    }

    getRuntimeHeartbeat(name: string) {
        return mapHeartbeatRow(
            this.db
                .prepare<RuntimeHeartbeatRow>("SELECT * FROM airifica_runtime_heartbeats WHERE name = ?")
                .get(String(name || "").trim().toLowerCase()),
        );
    }

    listRuntimeHeartbeats() {
        return this.db
            .prepare<RuntimeHeartbeatRow>("SELECT * FROM airifica_runtime_heartbeats ORDER BY last_seen_at DESC")
            .all()
            .map(mapHeartbeatRow)
            .filter((record): record is RuntimeHeartbeatRecord => Boolean(record));
    }

    pruneExpiredTelegramLinkCodes(now = Date.now()) {
        this.db
            .prepare("DELETE FROM airifica_telegram_link_codes WHERE expires_at <= ?")
            .run(now);
    }

    createTelegramLinkCode(walletAddress: string, ttlMs = 10 * 60_000) {
        this.pruneExpiredTelegramLinkCodes();
        const now = Date.now();
        const code = crypto.randomBytes(16).toString("hex");
        this.db.prepare(
            `
            INSERT INTO airifica_telegram_link_codes (code, wallet_address, created_at, expires_at)
            VALUES (?, ?, ?, ?)
            `,
        ).run(code, walletAddress, now, now + ttlMs);
        return {
            code,
            walletAddress,
            createdAt: now,
            expiresAt: now + ttlMs,
        } satisfies TelegramLinkCodeRecord;
    }

    consumeTelegramLinkCode(
        code: string,
        telegram: {
            chatId: string;
            userId: string;
            username?: string | null;
            firstName?: string | null;
        },
    ) {
        this.pruneExpiredTelegramLinkCodes();
        const record = mapTelegramLinkCodeRow(
            this.db
                .prepare<TelegramLinkCodeRow>("SELECT * FROM airifica_telegram_link_codes WHERE code = ?")
                .get(code),
        );
        if (!record)
            return null;

        const now = Date.now();
        const existing = this.getTelegramLink(telegram.chatId);
        const next: TelegramLinkRecord = {
            chatId: telegram.chatId,
            userId: telegram.userId,
            walletAddress: record.walletAddress,
            username: telegram.username?.trim() || null,
            firstName: telegram.firstName?.trim() || null,
            alertsEnabled: true,
            conversationalEnabled: true,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };

        const transaction = this.db.transaction(() => {
            this.db.prepare("DELETE FROM airifica_telegram_link_codes WHERE code = ?").run(code);
            this.db.prepare(
                `
                INSERT INTO airifica_telegram_links (
                    chat_id,
                    user_id,
                    wallet_address,
                    username,
                    first_name,
                    alerts_enabled,
                    conversational_enabled,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(chat_id) DO UPDATE SET
                    user_id = excluded.user_id,
                    wallet_address = excluded.wallet_address,
                    username = excluded.username,
                    first_name = excluded.first_name,
                    alerts_enabled = excluded.alerts_enabled,
                    conversational_enabled = excluded.conversational_enabled,
                    updated_at = excluded.updated_at
                `,
            ).run(
                next.chatId,
                next.userId,
                next.walletAddress,
                stringOrNull(next.username),
                stringOrNull(next.firstName),
                boolToDb(next.alertsEnabled),
                boolToDb(next.conversationalEnabled),
                Number(next.createdAt),
                Number(next.updatedAt),
            );
        });

        transaction();
        return next;
    }

    getTelegramLink(chatId: string) {
        return mapTelegramLinkRow(
            this.db.prepare<TelegramLinkRow>("SELECT * FROM airifica_telegram_links WHERE chat_id = ?").get(chatId),
        );
    }

    listTelegramLinks() {
        return this.db
            .prepare<TelegramLinkRow>("SELECT * FROM airifica_telegram_links ORDER BY updated_at DESC")
            .all()
            .map(mapTelegramLinkRow)
            .filter((record): record is TelegramLinkRecord => Boolean(record));
    }

    listTelegramLinksForWallet(walletAddress: string) {
        return this.db
            .prepare<TelegramLinkRow>(
                "SELECT * FROM airifica_telegram_links WHERE wallet_address = ? ORDER BY updated_at DESC",
            )
            .all(walletAddress)
            .map(mapTelegramLinkRow)
            .filter((record): record is TelegramLinkRecord => Boolean(record));
    }

    updateTelegramLink(chatId: string, patch: Partial<TelegramLinkRecord>) {
        const existing = this.getTelegramLink(chatId);
        if (!existing)
            return null;

        const next: TelegramLinkRecord = {
            ...existing,
            ...patch,
            updatedAt: Date.now(),
        };

        this.db.prepare(
            `
            UPDATE airifica_telegram_links
            SET user_id = ?,
                wallet_address = ?,
                username = ?,
                first_name = ?,
                alerts_enabled = ?,
                conversational_enabled = ?,
                created_at = ?,
                updated_at = ?
            WHERE chat_id = ?
            `,
        ).run(
            next.userId,
            next.walletAddress,
            stringOrNull(next.username),
            stringOrNull(next.firstName),
            boolToDb(next.alertsEnabled),
            boolToDb(next.conversationalEnabled),
            Number(next.createdAt),
            Number(next.updatedAt),
            chatId,
        );

        return next;
    }

    deleteTelegramLink(chatId: string) {
        const result = this.db.prepare("DELETE FROM airifica_telegram_links WHERE chat_id = ?").run(chatId);
        return result.changes > 0;
    }

    countPendingTelegramLinkCodes(now = Date.now()) {
        this.pruneExpiredTelegramLinkCodes(now);
        const row = this.db
            .prepare<{ total: number }>("SELECT COUNT(*) AS total FROM airifica_telegram_link_codes")
            .get();
        return Number(row?.total || 0);
    }

    createTelegramNotifications(
        walletAddress: string,
        kind: TelegramNotificationRecord["kind"],
        text: string,
        meta?: Record<string, unknown> | null,
    ) {
        const recipients = this.listTelegramLinksForWallet(walletAddress).filter((link) => link.alertsEnabled);
        if (!recipients.length)
            return [];

        const now = Date.now();
        const insert = this.db.prepare(
            `
            INSERT INTO airifica_telegram_notifications (
                wallet_address,
                chat_id,
                kind,
                text,
                meta_json,
                status,
                error_message,
                created_at,
                updated_at,
                delivered_at
            ) VALUES (?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?, NULL)
            `,
        );

        return recipients.map((link) => {
            const result = insert.run(
                walletAddress,
                link.chatId,
                kind,
                text,
                meta ? toJson(meta) : null,
                now,
                now,
            );
            return this.getTelegramNotification(Number(result.lastInsertRowid))!;
        });
    }

    private getTelegramNotification(id: number) {
        return mapTelegramNotificationRow(
            this.db
                .prepare<TelegramNotificationRow>("SELECT * FROM airifica_telegram_notifications WHERE id = ?")
                .get(id),
        );
    }

    listPendingTelegramNotifications(limit = 50) {
        return this.db
            .prepare<TelegramNotificationRow>(
                `
                SELECT * FROM airifica_telegram_notifications
                WHERE status = 'PENDING'
                ORDER BY created_at ASC
                LIMIT ?
                `,
            )
            .all(Math.max(1, limit))
            .map(mapTelegramNotificationRow)
            .filter((record): record is TelegramNotificationRecord => Boolean(record));
    }

    markTelegramNotificationDelivered(id: number) {
        const existing = this.getTelegramNotification(id);
        if (!existing)
            return null;
        const deliveredAt = Date.now();
        this.db.prepare(
            `
            UPDATE airifica_telegram_notifications
            SET status = 'DELIVERED',
                error_message = NULL,
                delivered_at = ?,
                updated_at = ?
            WHERE id = ?
            `,
        ).run(deliveredAt, deliveredAt, id);
        return this.getTelegramNotification(id);
    }

    markTelegramNotificationFailed(id: number, errorMessage: string) {
        const existing = this.getTelegramNotification(id);
        if (!existing)
            return null;
        const updatedAt = Date.now();
        this.db.prepare(
            `
            UPDATE airifica_telegram_notifications
            SET status = 'FAILED',
                error_message = ?,
                updated_at = ?
            WHERE id = ?
            `,
        ).run(String(errorMessage || "delivery failed"), updatedAt, id);
        return this.getTelegramNotification(id);
    }

    listTelegramNotifications() {
        return this.db
            .prepare<TelegramNotificationRow>("SELECT * FROM airifica_telegram_notifications ORDER BY updated_at DESC")
            .all()
            .map(mapTelegramNotificationRow)
            .filter((record): record is TelegramNotificationRecord => Boolean(record));
    }

    private getOnchainSpotWatchKey(walletAddress: string, mintAddress: string) {
        return `${walletAddress}:${mintAddress}`;
    }

    getOnchainSpotWatch(walletAddress: string, mintAddress: string) {
        return mapOnchainSpotWatchRow(
            this.db.prepare<OnchainSpotWatchRow>(
                `
                SELECT * FROM airifica_onchain_spot_watches
                WHERE wallet_address = ? AND mint_address = ?
                `,
            ).get(walletAddress, mintAddress),
        );
    }

    getOnchainWalletSync(walletAddress: string) {
        return mapOnchainWalletSyncRow(
            this.db
                .prepare<OnchainWalletSyncRow>("SELECT * FROM airifica_onchain_wallet_syncs WHERE wallet_address = ?")
                .get(walletAddress),
        );
    }

    upsertOnchainSpotWatch(
        walletAddress: string,
        mintAddress: string,
        patch: Partial<Omit<OnchainSpotWatchRecord, "walletAddress" | "mintAddress" | "createdAt" | "updatedAt">>,
    ) {
        const existing = this.getOnchainSpotWatch(walletAddress, mintAddress);
        const now = Date.now();
        const next: OnchainSpotWatchRecord = {
            walletAddress,
            mintAddress,
            symbol: patch.symbol ?? existing?.symbol ?? null,
            marketQuery: patch.marketQuery ?? existing?.marketQuery ?? null,
            decimals: patch.decimals ?? existing?.decimals ?? null,
            lastPriceUsd: patch.lastPriceUsd ?? existing?.lastPriceUsd ?? null,
            lastValueUsd: patch.lastValueUsd ?? existing?.lastValueUsd ?? null,
            lastSyncedAt: patch.lastSyncedAt ?? existing?.lastSyncedAt ?? null,
            lastTradeAt: patch.lastTradeAt ?? existing?.lastTradeAt ?? null,
            lastTxSignature: patch.lastTxSignature ?? existing?.lastTxSignature ?? null,
            lastNotionalUsd: patch.lastNotionalUsd ?? existing?.lastNotionalUsd ?? null,
            lastQuantity: patch.lastQuantity ?? existing?.lastQuantity ?? null,
            costBasisUsd: patch.costBasisUsd ?? existing?.costBasisUsd ?? null,
            realizedPnlUsd: patch.realizedPnlUsd ?? existing?.realizedPnlUsd ?? null,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };

        this.db.prepare(
            `
            INSERT INTO airifica_onchain_spot_watches (
                wallet_address,
                mint_address,
                symbol,
                market_query,
                decimals,
                last_price_usd,
                last_value_usd,
                last_synced_at,
                last_trade_at,
                last_tx_signature,
                last_notional_usd,
                last_quantity,
                cost_basis_usd,
                realized_pnl_usd,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(wallet_address, mint_address) DO UPDATE SET
                symbol = excluded.symbol,
                market_query = excluded.market_query,
                decimals = excluded.decimals,
                last_price_usd = excluded.last_price_usd,
                last_value_usd = excluded.last_value_usd,
                last_synced_at = excluded.last_synced_at,
                last_trade_at = excluded.last_trade_at,
                last_tx_signature = excluded.last_tx_signature,
                last_notional_usd = excluded.last_notional_usd,
                last_quantity = excluded.last_quantity,
                cost_basis_usd = excluded.cost_basis_usd,
                realized_pnl_usd = excluded.realized_pnl_usd,
                updated_at = excluded.updated_at
            `,
        ).run(
            next.walletAddress,
            next.mintAddress,
            stringOrNull(next.symbol),
            stringOrNull(next.marketQuery),
            integerOrNull(next.decimals),
            numberOrNull(next.lastPriceUsd),
            numberOrNull(next.lastValueUsd),
            integerOrNull(next.lastSyncedAt),
            integerOrNull(next.lastTradeAt),
            stringOrNull(next.lastTxSignature),
            numberOrNull(next.lastNotionalUsd),
            numberOrNull(next.lastQuantity),
            numberOrNull(next.costBasisUsd),
            numberOrNull(next.realizedPnlUsd),
            Number(next.createdAt),
            Number(next.updatedAt),
        );

        return next;
    }

    listOnchainSpotWatches() {
        return this.db
            .prepare<OnchainSpotWatchRow>("SELECT * FROM airifica_onchain_spot_watches ORDER BY updated_at DESC")
            .all()
            .map(mapOnchainSpotWatchRow)
            .filter((record): record is OnchainSpotWatchRecord => Boolean(record));
    }

    listOnchainSpotWatchesForWallet(walletAddress: string) {
        return this.db
            .prepare<OnchainSpotWatchRow>(
                `
                SELECT * FROM airifica_onchain_spot_watches
                WHERE wallet_address = ?
                ORDER BY updated_at DESC
                `,
            )
            .all(walletAddress)
            .map(mapOnchainSpotWatchRow)
            .filter((record): record is OnchainSpotWatchRecord => Boolean(record));
    }

    markOnchainWalletSnapshotSynced(
        walletAddress: string,
        patch: {
            lastSyncedAt: number;
            itemCount: number;
            source?: string | null;
        },
    ) {
        const existing = this.getOnchainWalletSync(walletAddress);
        const now = Date.now();
        const next: OnchainWalletSyncRecord = {
            walletAddress,
            lastSyncedAt: patch.lastSyncedAt,
            itemCount: Math.max(0, Number(patch.itemCount || 0)),
            source: patch.source ?? existing?.source ?? null,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };

        this.db.prepare(
            `
            INSERT INTO airifica_onchain_wallet_syncs (
                wallet_address,
                last_synced_at,
                item_count,
                source,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(wallet_address) DO UPDATE SET
                last_synced_at = excluded.last_synced_at,
                item_count = excluded.item_count,
                source = excluded.source,
                updated_at = excluded.updated_at
            `,
        ).run(
            next.walletAddress,
            integerOrNull(next.lastSyncedAt),
            Number(next.itemCount || 0),
            stringOrNull(next.source),
            Number(next.createdAt),
            Number(next.updatedAt),
        );

        return next;
    }

    syncOnchainSpotHolding(
        walletAddress: string,
        mintAddress: string,
        patch: {
            symbol?: string | null;
            marketQuery?: string | null;
            quantity: number;
            decimals?: number | null;
            priceUsd?: number | null;
            valueUsd?: number | null;
            txSignature?: string | null;
            lastSyncedAt?: number | null;
            note?: string | null;
        },
    ) {
        const existing = this.getOnchainSpotWatch(walletAddress, mintAddress);
        const nextQuantity = Math.max(0, Number(patch.quantity || 0));
        const currentQuantity = Math.max(0, Number(existing?.lastQuantity || 0));
        const priceUsd = Number(patch.priceUsd);
        const hasPrice = Number.isFinite(priceUsd) && priceUsd >= 0;
        const valueUsd = Number(patch.valueUsd);
        const hasValue = Number.isFinite(valueUsd) && valueUsd >= 0;
        const currentCostBasisUsd = Math.max(0, Number(existing?.costBasisUsd || 0));
        const currentRealizedPnlUsd = Number(existing?.realizedPnlUsd || 0);
        let nextCostBasisUsd = currentCostBasisUsd;
        let nextRealizedPnlUsd = currentRealizedPnlUsd;

        if (currentQuantity > 0 && nextQuantity < currentQuantity) {
            const soldQuantity = currentQuantity - nextQuantity;
            const averageCostUsd = currentCostBasisUsd > 0 ? currentCostBasisUsd / currentQuantity : 0;
            const removedCostBasisUsd = averageCostUsd * soldQuantity;
            nextCostBasisUsd = Math.max(0, currentCostBasisUsd - removedCostBasisUsd);
            if (hasPrice)
                nextRealizedPnlUsd += (priceUsd * soldQuantity) - removedCostBasisUsd;
        } else if (nextQuantity > currentQuantity) {
            const boughtQuantity = nextQuantity - currentQuantity;
            if (hasPrice)
                nextCostBasisUsd += priceUsd * boughtQuantity;
        } else if (nextQuantity === 0) {
            nextCostBasisUsd = 0;
        }

        const nextSymbol = patch.symbol ?? existing?.symbol ?? null;
        const nextDecimals = Number.isFinite(Number(patch.decimals)) ? Number(patch.decimals) : existing?.decimals ?? null;
        const nextMarketQuery = patch.marketQuery ?? existing?.marketQuery ?? null;
        const nextTxSignature = patch.txSignature ?? existing?.lastTxSignature ?? null;
        const nextPriceUsd = hasPrice ? priceUsd : existing?.lastPriceUsd ?? null;
        const nextValueUsd = hasValue
            ? valueUsd
            : (Number.isFinite(Number(nextPriceUsd)) && nextQuantity > 0 ? Number(nextPriceUsd) * nextQuantity : existing?.lastValueUsd ?? null);
        const nextLastSyncedAt = patch.lastSyncedAt ?? existing?.lastSyncedAt ?? null;
        const materiallyChanged =
            !existing
            || nextQuantity !== currentQuantity
            || nextSymbol !== (existing?.symbol ?? null)
            || nextDecimals !== (existing?.decimals ?? null)
            || nextMarketQuery !== (existing?.marketQuery ?? null)
            || nextTxSignature !== (existing?.lastTxSignature ?? null)
            || nextLastSyncedAt !== (existing?.lastSyncedAt ?? null)
            || Math.abs(Number(nextPriceUsd || 0) - Number(existing?.lastPriceUsd || 0)) > 0.000000001
            || Math.abs(Number(nextValueUsd || 0) - Number(existing?.lastValueUsd || 0)) > 0.000001
            || Math.abs(nextCostBasisUsd - currentCostBasisUsd) > 0.000001
            || Math.abs(nextRealizedPnlUsd - currentRealizedPnlUsd) > 0.000001;

        if (!materiallyChanged && existing)
            return existing;

        return this.upsertOnchainSpotWatch(walletAddress, mintAddress, {
            symbol: nextSymbol,
            marketQuery: nextMarketQuery,
            decimals: nextDecimals,
            lastPriceUsd: Number.isFinite(Number(nextPriceUsd)) ? Number(nextPriceUsd) : null,
            lastValueUsd: Number.isFinite(Number(nextValueUsd)) ? Number(nextValueUsd) : null,
            lastSyncedAt: nextLastSyncedAt,
            lastTradeAt: nextQuantity !== currentQuantity || nextTxSignature !== (existing?.lastTxSignature ?? null)
                ? Date.now()
                : existing?.lastTradeAt ?? null,
            lastTxSignature: nextTxSignature,
            lastNotionalUsd: Number.isFinite(Number(nextValueUsd))
                ? Number(nextValueUsd)
                : (hasPrice ? priceUsd * nextQuantity : existing?.lastNotionalUsd ?? null),
            lastQuantity: nextQuantity,
            costBasisUsd: nextCostBasisUsd,
            realizedPnlUsd: nextRealizedPnlUsd,
        });
    }

    appendTradeLedgerRecord(
        payload: Omit<TradeLedgerRecord, "id" | "createdAt" | "updatedAt">,
    ) {
        const now = Date.now();
        const result = this.db.prepare(
            `
            INSERT INTO airifica_trade_ledger (
                wallet_address,
                venue,
                market_type,
                symbol,
                side,
                quantity,
                notional_usd,
                margin_usd,
                leverage,
                realized_pnl_usd,
                mint_address,
                order_id,
                tx_signature,
                proposal_id,
                execution_source,
                note,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
        ).run(
            payload.walletAddress,
            payload.venue,
            payload.marketType,
            payload.symbol,
            payload.side,
            numberOrNull(payload.quantity),
            numberOrNull(payload.notionalUsd),
            numberOrNull(payload.marginUsd),
            numberOrNull(payload.leverage),
            numberOrNull(payload.realizedPnlUsd),
            stringOrNull(payload.mintAddress),
            stringOrNull(payload.orderId),
            stringOrNull(payload.txSignature),
            integerOrNull(payload.proposalId),
            stringOrNull(payload.executionSource),
            stringOrNull(payload.note),
            now,
            now,
        );
        const id = Number(result.lastInsertRowid);
        return this.getTradeLedgerRecord(id)!;
    }

    private getTradeLedgerRecord(id: number) {
        return mapTradeLedgerRow(
            this.db.prepare<TradeLedgerRow>("SELECT * FROM airifica_trade_ledger WHERE id = ?").get(id),
        );
    }

    listTradeLedgerForWallet(walletAddress: string) {
        return this.db
            .prepare<TradeLedgerRow>(
                `
                SELECT * FROM airifica_trade_ledger
                WHERE wallet_address = ?
                ORDER BY created_at DESC
                `,
            )
            .all(walletAddress)
            .map(mapTradeLedgerRow)
            .filter((record): record is TradeLedgerRecord => Boolean(record));
    }
}
