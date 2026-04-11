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

interface AirificaStateShape {
    nextProposalId: number;
    pacificaBindings: Record<string, PacificaBindingRecord>;
    proposals: Record<string, TradeProposalRecord>;
}

const DEFAULT_STATE: AirificaStateShape = {
    nextProposalId: 1,
    pacificaBindings: {},
    proposals: {},
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
                pacificaBindings: parsed.pacificaBindings && typeof parsed.pacificaBindings === 'object'
                    ? parsed.pacificaBindings as Record<string, PacificaBindingRecord>
                    : {},
                proposals: parsed.proposals && typeof parsed.proposals === 'object'
                    ? parsed.proposals as Record<string, TradeProposalRecord>
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
}
