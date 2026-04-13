import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { TradeProposal } from './types.ts';

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
    status: 'PROPOSED' | 'APPROVED' | 'EXECUTED' | 'FAILED' | 'REJECTED';
    errorMessage: string | null;
    orderId: string | null;
    createdAt: number;
    updatedAt: number;
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
    kind: 'TRADE_OPENED' | 'POSITION_CLOSED';
    text: string;
    status: 'PENDING' | 'DELIVERED' | 'FAILED';
    errorMessage: string | null;
    createdAt: number;
    updatedAt: number;
    deliveredAt: number | null;
}

interface AirificaStateShape {
    nextProposalId: number;
    nextTelegramNotificationId: number;
    pacificaBindings: Record<string, PacificaBindingRecord>;
    proposals: Record<string, TradeProposalRecord>;
    telegramLinkCodes: Record<string, TelegramLinkCodeRecord>;
    telegramLinks: Record<string, TelegramLinkRecord>;
    telegramNotifications: Record<string, TelegramNotificationRecord>;
}

const DEFAULT_STATE: AirificaStateShape = {
    nextProposalId: 1,
    nextTelegramNotificationId: 1,
    pacificaBindings: {},
    proposals: {},
    telegramLinkCodes: {},
    telegramLinks: {},
    telegramNotifications: {},
};

function resolveStateFilePath() {
    const configuredDir = (process.env.AIRIFICA_DATA_DIR || process.env.AIRI3_DATA_DIR || '').trim();
    const baseDir = configuredDir
        ? path.resolve(configuredDir)
        : path.resolve(process.cwd(), 'data', 'airifica');

    return path.join(baseDir, 'airifica-state.json');
}

export class AirificaStateStore {
    private readonly stateFilePath = resolveStateFilePath();
    private state: AirificaStateShape = { ...DEFAULT_STATE };

    constructor() {
        this.load();
    }

    private ensureDirectory() {
        fs.mkdirSync(path.dirname(this.stateFilePath), { recursive: true });
    }

    private load() {
        this.ensureDirectory();
        if (!fs.existsSync(this.stateFilePath)) {
            this.persist();
            return;
        }

        try {
            const raw = fs.readFileSync(this.stateFilePath, 'utf8');
            const parsed = raw ? JSON.parse(raw) as Partial<AirificaStateShape> : {};
            this.state = {
                nextProposalId: Number(parsed.nextProposalId || DEFAULT_STATE.nextProposalId),
                nextTelegramNotificationId: Number(parsed.nextTelegramNotificationId || DEFAULT_STATE.nextTelegramNotificationId),
                pacificaBindings: parsed.pacificaBindings && typeof parsed.pacificaBindings === 'object'
                    ? parsed.pacificaBindings as Record<string, PacificaBindingRecord>
                    : {},
                proposals: parsed.proposals && typeof parsed.proposals === 'object'
                    ? parsed.proposals as Record<string, TradeProposalRecord>
                    : {},
                telegramLinkCodes: parsed.telegramLinkCodes && typeof parsed.telegramLinkCodes === 'object'
                    ? parsed.telegramLinkCodes as Record<string, TelegramLinkCodeRecord>
                    : {},
                telegramLinks: parsed.telegramLinks && typeof parsed.telegramLinks === 'object'
                    ? parsed.telegramLinks as Record<string, TelegramLinkRecord>
                    : {},
                telegramNotifications: parsed.telegramNotifications && typeof parsed.telegramNotifications === 'object'
                    ? parsed.telegramNotifications as Record<string, TelegramNotificationRecord>
                    : {},
            };
        } catch {
            this.state = { ...DEFAULT_STATE };
            this.persist();
        }
    }

    private persist() {
        this.ensureDirectory();
        const tempPath = `${this.stateFilePath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2));
        fs.renameSync(tempPath, this.stateFilePath);
    }

    getBinding(walletAddress: string) {
        return this.state.pacificaBindings[walletAddress] || null;
    }

    upsertBinding(walletAddress: string, patch: Omit<PacificaBindingRecord, 'walletAddress' | 'createdAt' | 'updatedAt'>) {
        const existing = this.getBinding(walletAddress);
        const now = Date.now();
        const next: PacificaBindingRecord = {
            walletAddress,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            ...existing,
            ...patch,
        };
        this.state.pacificaBindings[walletAddress] = next;
        this.persist();
        return next;
    }

    updateBinding(walletAddress: string, patch: Partial<PacificaBindingRecord>) {
        const existing = this.getBinding(walletAddress);
        if (!existing)
            return null;

        const next = {
            ...existing,
            ...patch,
            updatedAt: Date.now(),
        } satisfies PacificaBindingRecord;
        this.state.pacificaBindings[walletAddress] = next;
        this.persist();
        return next;
    }

    createProposal(walletAddress: string, conversationId: string, proposal: TradeProposal) {
        const id = this.state.nextProposalId++;
        const now = Date.now();
        const record: TradeProposalRecord = {
            id,
            walletAddress,
            conversationId,
            proposal,
            status: 'PROPOSED',
            errorMessage: null,
            orderId: null,
            createdAt: now,
            updatedAt: now,
        };
        this.state.proposals[String(id)] = record;
        this.persist();
        return record;
    }

    getProposal(id: number) {
        return this.state.proposals[String(id)] || null;
    }

    updateProposal(id: number, patch: Partial<TradeProposalRecord>) {
        const existing = this.getProposal(id);
        if (!existing)
            return null;

        const next = {
            ...existing,
            ...patch,
            updatedAt: Date.now(),
        } satisfies TradeProposalRecord;
        this.state.proposals[String(id)] = next;
        this.persist();
        return next;
    }

    pruneExpiredTelegramLinkCodes(now = Date.now()) {
        let dirty = false;
        for (const [code, record] of Object.entries(this.state.telegramLinkCodes)) {
            if (record.expiresAt <= now) {
                delete this.state.telegramLinkCodes[code];
                dirty = true;
            }
        }
        if (dirty)
            this.persist();
    }

    createTelegramLinkCode(walletAddress: string, ttlMs = 10 * 60_000) {
        this.pruneExpiredTelegramLinkCodes();
        const now = Date.now();
        const code = crypto.randomBytes(16).toString('hex');
        const record: TelegramLinkCodeRecord = {
            code,
            walletAddress,
            createdAt: now,
            expiresAt: now + ttlMs,
        };
        this.state.telegramLinkCodes[code] = record;
        this.persist();
        return record;
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
        const record = this.state.telegramLinkCodes[code];
        if (!record)
            return null;

        delete this.state.telegramLinkCodes[code];
        const now = Date.now();
        const next: TelegramLinkRecord = {
            chatId: telegram.chatId,
            userId: telegram.userId,
            walletAddress: record.walletAddress,
            username: telegram.username?.trim() || null,
            firstName: telegram.firstName?.trim() || null,
            alertsEnabled: true,
            conversationalEnabled: true,
            createdAt: this.state.telegramLinks[telegram.chatId]?.createdAt || now,
            updatedAt: now,
        };
        this.state.telegramLinks[telegram.chatId] = next;
        this.persist();
        return next;
    }

    getTelegramLink(chatId: string) {
        return this.state.telegramLinks[chatId] || null;
    }

    listTelegramLinksForWallet(walletAddress: string) {
        return Object.values(this.state.telegramLinks)
            .filter(link => link.walletAddress === walletAddress)
            .sort((left, right) => right.updatedAt - left.updatedAt);
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
        this.state.telegramLinks[chatId] = next;
        this.persist();
        return next;
    }

    deleteTelegramLink(chatId: string) {
        const existing = this.getTelegramLink(chatId);
        if (!existing)
            return false;
        delete this.state.telegramLinks[chatId];
        this.persist();
        return true;
    }

    createTelegramNotifications(
        walletAddress: string,
        kind: TelegramNotificationRecord['kind'],
        text: string,
    ) {
        const recipients = this.listTelegramLinksForWallet(walletAddress)
            .filter(link => link.alertsEnabled);
        if (!recipients.length)
            return [];

        const now = Date.now();
        const notifications = recipients.map((link) => {
            const id = this.state.nextTelegramNotificationId++;
            const record: TelegramNotificationRecord = {
                id,
                walletAddress,
                chatId: link.chatId,
                kind,
                text,
                status: 'PENDING',
                errorMessage: null,
                createdAt: now,
                updatedAt: now,
                deliveredAt: null,
            };
            this.state.telegramNotifications[String(id)] = record;
            return record;
        });
        this.persist();
        return notifications;
    }

    listPendingTelegramNotifications(limit = 50) {
        return Object.values(this.state.telegramNotifications)
            .filter(notification => notification.status === 'PENDING')
            .sort((left, right) => left.createdAt - right.createdAt)
            .slice(0, limit);
    }

    markTelegramNotificationDelivered(id: number) {
        const existing = this.state.telegramNotifications[String(id)];
        if (!existing)
            return null;
        existing.status = 'DELIVERED';
        existing.errorMessage = null;
        existing.deliveredAt = Date.now();
        existing.updatedAt = Date.now();
        this.persist();
        return existing;
    }

    markTelegramNotificationFailed(id: number, errorMessage: string) {
        const existing = this.state.telegramNotifications[String(id)];
        if (!existing)
            return null;
        existing.status = 'FAILED';
        existing.errorMessage = errorMessage;
        existing.updatedAt = Date.now();
        this.persist();
        return existing;
    }
}
