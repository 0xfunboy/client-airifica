import crypto from 'node:crypto';

import { base58Encode } from './auth.ts';

export interface PacificaRequestContext {
    account: string;
    agentWalletPrivateKeyPkcs8Base64: string;
    agentWalletPublicKey: string;
    builderCode: string;
    apiBase: string;
    expiryWindowMs: number;
    apiKey?: string | null;
}

export interface PacificaBuilderApproval {
    builder_code: string;
    description?: string | null;
    max_fee_rate?: string | null;
    updated_at?: number | null;
}

type PacificaTpsl = {
    stop_price: string;
    limit_price: string;
    client_order_id?: string;
};

export interface CreateMarketOrderContextPayload {
    symbol: string;
    side: 'bid' | 'ask';
    size: number;
    requestedNotionalUsd?: number;
    slippage_percent?: string;
    reduce_only?: boolean;
    take_profit?: PacificaTpsl;
    stop_loss?: PacificaTpsl;
}

const ALGORITHM = 'aes-256-gcm';
function envValue(name: string, fallback = '') {
    return process.env[`AIRIFICA_${name}`] ?? process.env[`AIRI3_${name}`] ?? fallback;
}

const PACIFICA_MARKET_LOT_SIZE = Math.max(1e-12, Number(envValue('PACIFICA_MARKET_LOT_SIZE', '0.00001')));
const MARKET_INFO_CACHE_TTL_MS = 5 * 60_000;
const marketInfoCache = new Map<string, { expiresAt: number, value: PacificaMarketInfo | null }>();

interface PacificaMarketInfo {
    symbol: string;
    lot_size?: string | null;
    min_order_size?: string | null;
}

export interface PacificaPriceRow {
    symbol: string;
    mark?: string | null;
    mid?: string | null;
    oracle?: string | null;
    funding?: string | null;
    next_funding?: string | null;
    timestamp?: number | null;
    [key: string]: unknown;
}

function toSortedValue(value: any): any {
    if (Array.isArray(value))
        return value.map(toSortedValue);

    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce<Record<string, any>>((acc, key) => {
                acc[key] = toSortedValue(value[key]);
                return acc;
            }, {});
    }

    return value;
}

function getEncryptionKey(serverEncryptionKeyHex: string) {
    const key = Buffer.from(serverEncryptionKeyHex, 'hex');
    if (key.length !== 32)
        throw new Error('AIRIFICA_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
    return key;
}

export function encryptAgentPrivateKey(plaintextPkcs8Base64: string, serverEncryptionKeyHex: string) {
    const key = getEncryptionKey(serverEncryptionKeyHex);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintextPkcs8Base64, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptAgentPrivateKey(encryptedBase64: string, serverEncryptionKeyHex: string) {
    const key = getEncryptionKey(serverEncryptionKeyHex);
    const buffer = Buffer.from(encryptedBase64, 'base64');
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const ciphertext = buffer.subarray(28);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
}

export function generateAgentWallet() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
    const publicKeyRaw = publicKeyDer.subarray(-32);
    const privateKeyDer = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;

    return {
        publicKey: base58Encode(publicKeyRaw),
        privateKeyPkcs8Base64: privateKeyDer.toString('base64'),
    };
}

function buildContextSignature(
    type: string,
    operationData: Record<string, any>,
    ctx: PacificaRequestContext,
) {
    const timestamp = Date.now();
    const expiry_window = ctx.expiryWindowMs;
    const signatureHeader: Record<string, any> = { type, timestamp, expiry_window };
    const toSign = toSortedValue({ ...signatureHeader, data: operationData });
    const message = JSON.stringify(toSign);
    const keyObject = crypto.createPrivateKey({
        key: Buffer.from(ctx.agentWalletPrivateKeyPkcs8Base64, 'base64'),
        format: 'der',
        type: 'pkcs8',
    });
    const signature = crypto.sign(null, Buffer.from(message, 'utf8'), keyObject);
    return {
        signature: base58Encode(signature),
        timestamp,
        expiry_window,
    };
}

function buildApproveBuilderSubmission(
    account: string,
    signedPayload: Record<string, any>,
) {
    const builderCode = String(signedPayload?.builder_code || '').trim();
    const maxFeeRate = String(signedPayload?.max_fee_rate || '').trim();
    const signature = String(signedPayload?.signature || '').trim();
    const timestamp = Number(signedPayload?.timestamp);
    const expiryWindow = Number(signedPayload?.expiry_window);

    if (!account)
        throw new Error('Pacifica builder approval rejected: missing account');
    if (!builderCode)
        throw new Error('Pacifica builder approval rejected: missing builder_code');
    if (!maxFeeRate)
        throw new Error('Pacifica builder approval rejected: missing max_fee_rate');
    if (!signature)
        throw new Error('Pacifica builder approval rejected: missing signature');
    if (!Number.isFinite(timestamp))
        throw new Error('Pacifica builder approval rejected: invalid timestamp');
    if (!Number.isFinite(expiryWindow))
        throw new Error('Pacifica builder approval rejected: invalid expiry_window');

    return {
        account,
        agent_wallet: null,
        signature,
        timestamp,
        expiry_window: expiryWindow,
        builder_code: builderCode,
        max_fee_rate: maxFeeRate,
    };
}

async function requestWithContext<T>(
    ctx: Pick<PacificaRequestContext, 'apiBase' | 'apiKey'>,
    path: string,
    body?: any,
    method: 'GET' | 'POST' = 'GET',
    extraHeaders?: Record<string, string>,
): Promise<T> {
    const url = `${ctx.apiBase.replace(/\/$/, '')}${path}`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...extraHeaders,
    };
    if (ctx.apiKey) {
        headers['PF-API-KEY'] = ctx.apiKey;
        headers['x-api-key'] = ctx.apiKey;
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
            const response = await fetch(url, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if ((response.status === 429 || response.status >= 500) && attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
                continue;
            }

            const text = await response.text().catch(() => '');
            let payload: any = null;
            if (text) {
                try {
                    payload = JSON.parse(text);
                } catch {
                    payload = text;
                }
            }

            if (!response.ok) {
                throw new Error(`Pacifica ${method} ${path} ${response.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
            }

            if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.success === false) {
                throw new Error(`Pacifica ${method} ${path} ${response.status}: ${payload.error || JSON.stringify(payload)}`);
            }

            return payload as T;
        } catch (error) {
            clearTimeout(timeout);
            if (attempt === 3)
                throw error;
        }
    }

    throw new Error(`Pacifica ${method} ${path}: request failed`);
}

function lotDecimals(step: number) {
    const text = String(step);
    if (!text.includes('.'))
        return 0;
    return text.length - text.indexOf('.') - 1;
}

function quantizeToLot(raw: number, lot: number, mode: 'floor' | 'ceil' = 'floor') {
    const ratio = raw / lot;
    const steps = mode === 'ceil' ? Math.ceil(ratio - 1e-12) : Math.floor(ratio + 1e-12);
    const quantity = steps * lot;
    return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

function toFiniteNumber(value: unknown) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

async function fetchMarketInfoForSymbol(
    ctx: Pick<PacificaRequestContext, 'apiBase' | 'apiKey'>,
    symbol: string,
) {
    const normalizedSymbol = String(symbol || '').toUpperCase().trim();
    const cached = marketInfoCache.get(normalizedSymbol);
    const now = Date.now();
    if (cached && cached.expiresAt > now)
        return cached.value;

    const payload = await requestWithContext<any>(ctx, '/api/v1/info');
    const contracts = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    const marketInfo = (contracts.find((entry: any) => String(entry?.symbol || '').toUpperCase() === normalizedSymbol) || null) as PacificaMarketInfo | null;
    marketInfoCache.set(normalizedSymbol, {
        expiresAt: now + MARKET_INFO_CACHE_TTL_MS,
        value: marketInfo,
    });
    return marketInfo;
}

export function buildBindAgentWalletPayload(
    agentWalletPublicKey: string,
    expiryWindowMs = 60_000,
) {
    const timestamp = Date.now();
    return {
        type: 'bind_agent_wallet',
        timestamp,
        expiry_window: expiryWindowMs,
        data: {
            agent_wallet: agentWalletPublicKey,
        },
    };
}

export function buildApproveBuilderPayload(
    builderCode: string,
    maxFeeRate = '0.001',
    expiryWindowMs = 60_000,
) {
    const timestamp = Date.now();
    return {
        type: 'approve_builder_code',
        timestamp,
        expiry_window: expiryWindowMs,
        data: {
            builder_code: builderCode,
            max_fee_rate: maxFeeRate,
        },
    };
}

export async function submitBindAgentWallet(
    ctx: Pick<PacificaRequestContext, 'apiBase' | 'apiKey'>,
    account: string,
    signedPayload: Record<string, any>,
) {
    const agentWallet = String(signedPayload?.agent_wallet || '').trim();
    const signature = String(signedPayload?.signature || '').trim();
    const timestamp = Number(signedPayload?.timestamp);
    const expiryWindow = Number(signedPayload?.expiry_window);

    if (!account)
        throw new Error('Pacifica bind rejected: missing account');
    if (!agentWallet)
        throw new Error('Pacifica bind rejected: missing agent_wallet');
    if (!signature)
        throw new Error('Pacifica bind rejected: missing signature');
    if (!Number.isFinite(timestamp))
        throw new Error('Pacifica bind rejected: invalid timestamp');
    if (!Number.isFinite(expiryWindow))
        throw new Error('Pacifica bind rejected: invalid expiry_window');

    return await requestWithContext(ctx, '/api/v1/agent/bind', {
        account,
        agent_wallet: agentWallet,
        signature,
        timestamp,
        expiry_window: expiryWindow,
    }, 'POST');
}

export async function submitApproveBuilder(
    ctx: Pick<PacificaRequestContext, 'apiBase' | 'apiKey'>,
    account: string,
    signedPayload: Record<string, any>,
) {
    return await requestWithContext(
        ctx,
        '/api/v1/account/builder_codes/approve',
        buildApproveBuilderSubmission(account, signedPayload),
        'POST',
    );
}

export async function fetchPositionsForAccount(
    ctx: Pick<PacificaRequestContext, 'account' | 'apiBase' | 'apiKey'>,
) {
    const query = new URLSearchParams({ account: ctx.account });
    const result = await requestWithContext<any>(ctx, `/api/v1/positions?${query.toString()}`);
    if (Array.isArray(result))
        return result;
    if (Array.isArray(result?.data))
        return result.data;
    return [];
}

export async function fetchAccountSnapshotForAccount(
    ctx: Pick<PacificaRequestContext, 'account' | 'apiBase' | 'apiKey'>,
) {
    const query = new URLSearchParams({ account: ctx.account });
    return await requestWithContext<any>(ctx, `/api/v1/account?${query.toString()}`);
}

export async function fetchBuilderApprovalsForAccount(
    ctx: Pick<PacificaRequestContext, 'account' | 'apiBase' | 'apiKey'>,
) {
    const query = new URLSearchParams({ account: ctx.account });
    const result = await requestWithContext<any>(ctx, `/api/v1/account/builder_codes/approvals?${query.toString()}`);
    if (Array.isArray(result))
        return result as PacificaBuilderApproval[];
    if (Array.isArray(result?.data))
        return result.data as PacificaBuilderApproval[];
    return [] as PacificaBuilderApproval[];
}

export async function fetchOrdersForAccount(
    ctx: Pick<PacificaRequestContext, 'account' | 'apiBase' | 'apiKey'>,
) {
    const query = new URLSearchParams({ account: ctx.account });
    const result = await requestWithContext<any>(ctx, `/api/v1/orders?${query.toString()}`);
    if (Array.isArray(result))
        return result;
    if (Array.isArray(result?.data))
        return result.data;
    return [];
}

export async function fetchPriceRows(
    ctx: Pick<PacificaRequestContext, 'apiBase' | 'apiKey'>,
) {
    const result = await requestWithContext<any>(ctx, '/api/v1/info/prices');
    if (Array.isArray(result))
        return result as PacificaPriceRow[];
    if (Array.isArray(result?.data))
        return result.data as PacificaPriceRow[];
    return [] as PacificaPriceRow[];
}

export async function createMarketOrderForContext(
    ctx: PacificaRequestContext,
    payload: CreateMarketOrderContextPayload,
) {
    const symbol = String(payload.symbol || '').toUpperCase().replace(/[^A-Z0-9_\-./]/g, '');
    if (!symbol)
        throw new Error('Pacifica context order rejected: invalid symbol');
    if (!Number.isFinite(payload.size) || payload.size <= 0)
        throw new Error('Pacifica context order rejected: invalid size');

    const marketInfo = await fetchMarketInfoForSymbol(ctx, symbol);
    const marketLotSize = Math.max(1e-12, toFiniteNumber(marketInfo?.lot_size) || PACIFICA_MARKET_LOT_SIZE);
    const minimumOrderSizeUsd = toFiniteNumber(marketInfo?.min_order_size);
    let normalizedSize = quantizeToLot(payload.size, marketLotSize, 'floor');
    const requestedNotionalUsd = toFiniteNumber(payload.requestedNotionalUsd);
    if (
        normalizedSize
        && !payload.reduce_only
        && minimumOrderSizeUsd != null
        && requestedNotionalUsd != null
        && requestedNotionalUsd >= minimumOrderSizeUsd
    ) {
        const estimatedNotionalUsd = requestedNotionalUsd * (normalizedSize / payload.size);
        if (estimatedNotionalUsd < minimumOrderSizeUsd) {
            normalizedSize = quantizeToLot(payload.size, marketLotSize, 'ceil');
        }
    }
    if (!normalizedSize)
        throw new Error(`Pacifica context order rejected: size ${payload.size} too small for lot ${marketLotSize}`);

    const operationData: Record<string, any> = {
        symbol,
        side: payload.side,
        amount: normalizedSize.toFixed(lotDecimals(marketLotSize)),
        reduce_only: Boolean(payload.reduce_only),
        slippage_percent: payload.slippage_percent ?? '0.5',
        client_order_id: crypto.randomUUID(),
        builder_code: ctx.builderCode,
    };
    if (payload.take_profit)
        operationData.take_profit = {
            ...payload.take_profit,
            client_order_id: payload.take_profit.client_order_id || crypto.randomUUID(),
        };
    if (payload.stop_loss)
        operationData.stop_loss = {
            ...payload.stop_loss,
            client_order_id: payload.stop_loss.client_order_id || crypto.randomUUID(),
        };

    const signed = buildContextSignature('create_market_order', operationData, ctx);
    const body = {
        account: ctx.account,
        agent_wallet: ctx.agentWalletPublicKey,
        ...signed,
        ...operationData,
    };

    return await requestWithContext(
        ctx,
        '/api/v1/orders/create_market',
        body,
        'POST',
        { agent_wallet: ctx.agentWalletPublicKey },
    );
}
