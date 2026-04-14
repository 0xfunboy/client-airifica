import express, { Request, Response } from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import { Connection, PublicKey } from "@solana/web3.js";
import { elizaLogger } from "@elizaos/core";
import type { IAgentRuntime } from "@elizaos/core";
import {
    buildSolanaAuthMessage,
    consumeNonce,
    createNonce,
    isValidSolanaAddress,
    parseSolanaAuthMessage,
    pruneNonces,
    signAuthToken,
    verifyAuthToken,
    verifySolanaSignature,
} from "./auth.ts";
import { AirificaMessageManager } from "./messageManager.ts";
import { fetchMarketContext, fetchPacificaMarketUniverse, normalizeMarketContextQuery, primePacificaMarketUniverse } from "./market-context.ts";
import {
    buildApproveBuilderPayload,
    buildBindAgentWalletPayload,
    createMarketOrderForContext,
    decryptAgentPrivateKey,
    encryptAgentPrivateKey,
    fetchAccountSnapshotForAccount,
    fetchBuilderApprovalsForAccount,
    fetchOrdersForAccount,
    fetchPriceRows,
    fetchPositionsForAccount,
    generateAgentWallet,
    submitApproveBuilder,
    submitBindAgentWallet,
    type PacificaBuilderApproval,
    type PacificaPriceRow,
    type PacificaRequestContext,
} from "./pacifica.ts";
import { AirificaStateStore } from "./state.ts";
import type {
    AirificaSessionRequest,
    AirificaSessionResponse,
    AirificaIncomingMessage,
    ConnectedClient,
    AirificaProposalRequest,
} from "./types.ts";

function envValue(name: string, fallback = "") {
    return process.env[`AIRIFICA_${name}`] ?? process.env[`AIRI3_${name}`] ?? fallback;
}

const DEFAULT_PORT = Number(envValue("PORT", "4040"));
const NODE_ENV = process.env.NODE_ENV || "development";
const CORS_ORIGIN = envValue("CORS_ORIGIN");
const MAX_JSON_BODY = envValue("JSON_LIMIT", "1mb");
const PACIFICA_API_BASE = (process.env.PACIFICA_API_BASE || process.env.AUTO_PACIFICA_API_BASE || "https://api.pacifica.fi").replace(/\/$/, "");
const PACIFICA_PUBLIC_API_BASE = (envValue("PACIFICA_PUBLIC_API_BASE", process.env.PACIFICA_PUBLIC_API_BASE || "https://api.pacifica.fi/api/v1")).replace(/\/$/, "");
const PACIFICA_BUILDER_CODE = (process.env.PACIFICA_BUILDER_CODE || "").trim();
const PACIFICA_API_KEY = (process.env.AUTO_PACIFICA_API_KEY || "").trim() || null;
const PACIFICA_EXPIRY_MS = Number(process.env.AUTO_PACIFICA_EXPIRY_MS || 60_000);
const AIRIFICA_ENCRYPTION_KEY = envValue("ENCRYPTION_KEY").trim();
const AIRIFICA_DEFAULT_NOTIONAL_USD = Number(envValue("DEFAULT_NOTIONAL_USD", "100"));
const PACIFICA_BUILDER_MAX_FEE_RATE = envValue("PACIFICA_BUILDER_MAX_FEE_RATE", "0.001").trim();
const PACIFICA_UNIVERSE_WARM_MS = Math.max(60_000, Number(process.env.PACIFICA_SYMBOLS_TTL_MS || 6 * 60 * 60_000));
const PACIFICA_BETA_ACCESS_URL = envValue("PACIFICA_BETA_ACCESS_URL", "https://app.pacifica.fi/portfolio").trim();
const AIRIFICA_PUBLIC_APP_URL = envValue("PUBLIC_APP_URL").trim();
const AIRIFICA_TELEGRAM_BOT_USERNAME = String(
    envValue("TELEGRAM_BOT_USERNAME")
    || "",
).trim().replace(/^@/, "");
const AIRIFICA_TELEGRAM_LINK_CODE_TTL_MS = Math.max(60_000, Number(envValue("TELEGRAM_LINK_CODE_TTL_MS", "600000")));
const AIRIFICA_TELEGRAM_HEARTBEAT_STALE_MS = Math.max(30_000, Number(envValue("TELEGRAM_HEARTBEAT_STALE_MS", "120000")));
const AIRIFICA_TELEGRAM_INTERNAL_SECRET = String(
    envValue("TELEGRAM_INTERNAL_SECRET")
    || envValue("TELEGRAM_BOT_TOKEN")
    || "",
).trim();
const AIRIFICA_TELEGRAM_NOTIFY_BASE_URL = AIRIFICA_PUBLIC_APP_URL || null;
const SOLANA_RPC_URL = (envValue("SOLANA_RPC_URL", process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com")).trim();
const AIRIFICA_ADMIN_WALLETS = new Set(
    envValue("ADMIN_WALLETS")
        .split(/[,\s]+/)
        .map(value => value.trim())
        .filter(Boolean),
);
const solanaConnection = SOLANA_RPC_URL ? new Connection(SOLANA_RPC_URL, "confirmed") : null;
const SOLANA_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ONCHAIN_SPOT_EXCLUDED_MINTS = new Set([
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "Es9vMFrzaCER4W9xJfYbVNewc19hXtF87mpy4VbQ5KMc",
]);

const parseOriginList = (value: string) =>
    value
        .split(/[,\s]+/)
        .map(origin => origin.trim())
        .filter(Boolean);

const configuredCorsOrigins = new Set(parseOriginList(CORS_ORIGIN));
const privateNetworkOriginPattern = /^https?:\/\/(?:(?:localhost|127\.0\.0\.1)(?::\d+)?|(?:10|192\.168)(?:\.\d{1,3}){2}(?::\d+)?|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}(?::\d+)?)$/i;

function isAllowedCorsOrigin(origin?: string | null) {
    if (!origin)
        return true;

    if (configuredCorsOrigins.size > 0)
        return configuredCorsOrigins.has(origin);

    return NODE_ENV !== "production" && privateNetworkOriginPattern.test(origin);
}

function applySecurityHeaders(res: Response) {
    res.setHeader("Content-Security-Policy", "base-uri 'self'; frame-ancestors 'none'; object-src 'none'");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
}

function compact(text: string) {
    return text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isAdminWallet(address: string) {
    return AIRIFICA_ADMIN_WALLETS.has(String(address || "").trim());
}

function assertSecurityConfiguration() {
    if (NODE_ENV === "production" && configuredCorsOrigins.size === 0) {
        throw new Error("Refusing to start client-airifica in production without AIRIFICA_CORS_ORIGIN configured.");
    }
}

function isValidSessionIdentity(value: string) {
    return /^[a-zA-Z0-9:_-]{3,128}$/.test(value);
}

function getHost(req: Request) {
    return req.get("host") || "localhost";
}

function getPublicAppHost(req: Request) {
    if (AIRIFICA_PUBLIC_APP_URL) {
        try {
            return new URL(AIRIFICA_PUBLIC_APP_URL).host;
        } catch {
        }
    }

    const forwardedHost = req.get("x-forwarded-host");
    if (forwardedHost)
        return forwardedHost.split(",")[0]?.trim() || forwardedHost;

    const origin = req.get("origin");
    if (origin) {
        try {
            return new URL(origin).host;
        } catch {
        }
    }

    return getHost(req);
}

function normalizeSymbol(raw: unknown) {
    const value = String(raw ?? "").toUpperCase().trim();
    if (!value)
        return "";
    if (value.includes("/"))
        return value.split("/")[0] || value;
    if (value.includes("-"))
        return value.split("-")[0] || value;
    if (value.endsWith("USDT"))
        return value.slice(0, -4);
    if (value.endsWith("USD"))
        return value.slice(0, -3);
    return value.replace(/[^A-Z0-9]/g, "");
}

function normalizePacificaSide(sideRaw: unknown, amountRaw: unknown): "LONG" | "SHORT" | null {
    const side = String(sideRaw ?? "").toUpperCase();
    if (side === "LONG" || side === "BID" || side === "BUY")
        return "LONG";
    if (side === "SHORT" || side === "ASK" || side === "SELL")
        return "SHORT";

    const amount = Number(amountRaw);
    if (Number.isFinite(amount) && amount !== 0)
        return amount > 0 ? "LONG" : "SHORT";

    return null;
}

function normalizeAmount(amountRaw: unknown) {
    const amount = Math.abs(Number(amountRaw));
    return Number.isFinite(amount) ? amount : 0;
}

function normalizeOrderPrice(order: any) {
    const candidates = [
        order?.stop_price,
        order?.stopPrice,
        order?.trigger_price,
        order?.triggerPrice,
        order?.limit_price,
        order?.limitPrice,
        order?.price,
    ];

    for (const candidate of candidates) {
        const numeric = Number(candidate);
        if (Number.isFinite(numeric) && numeric > 0)
            return numeric;
    }

    return 0;
}

function isReduceOnlyOrder(order: any) {
    return Boolean(order?.reduce_only ?? order?.reduceOnly);
}

function normalizeOrderSymbol(order: any) {
    return normalizeSymbol(order?.symbol ?? order?.market ?? order?.ticker);
}

function formatUsdCompact(value: number) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return "0.00";
    return numeric.toFixed(Math.abs(numeric) >= 100 ? 2 : 4);
}

function shortWallet(value: unknown) {
    const text = String(value ?? "").trim();
    if (text.length <= 14)
        return text;
    return `${text.slice(0, 6)}…${text.slice(-6)}`;
}

function pickBracketPrice(
    side: "LONG" | "SHORT" | null,
    entryPrice: number,
    orders: any[],
    target: "tp" | "sl",
) {
    if (!side || !Number.isFinite(entryPrice) || entryPrice <= 0)
        return 0;

    const candidates = orders
        .filter(order => isReduceOnlyOrder(order))
        .map((order) => {
            const price = normalizeOrderPrice(order);
            if (!Number.isFinite(price) || price <= 0)
                return null;

            const isTp = side === "LONG" ? price > entryPrice : price < entryPrice;
            const isSl = side === "LONG" ? price < entryPrice : price > entryPrice;
            if (target === "tp" && !isTp)
                return null;
            if (target === "sl" && !isSl)
                return null;

            return {
                price,
                updatedAt: Number(order?.updated_at ?? order?.created_at ?? 0) || 0,
            };
        })
        .filter(Boolean) as { price: number, updatedAt: number }[];

    if (!candidates.length)
        return 0;

    candidates.sort((left, right) => {
        const delta = Math.abs(left.price - entryPrice) - Math.abs(right.price - entryPrice);
        if (delta !== 0)
            return delta;
        return right.updatedAt - left.updatedAt;
    });

    return candidates[0]?.price || 0;
}

function mapPacificaPosition(position: any, options?: { orders?: any[], priceRow?: PacificaPriceRow | null }) {
    const symbol = normalizeSymbol(position?.symbol ?? position?.market ?? position?.ticker);
    const amount = normalizeAmount(position?.amount ?? position?.size ?? position?.position_size ?? position?.qty);
    const side = normalizePacificaSide(
        position?.side ?? position?.position_side ?? position?.direction,
        position?.amount ?? position?.size ?? position?.position_size ?? position?.qty,
    );
    const entryPrice = Number(position?.entry_price ?? position?.entryPrice ?? 0) || 0;
    const markPrice = Number(
        options?.priceRow?.mark
        ?? options?.priceRow?.mid
        ?? options?.priceRow?.oracle
        ?? position?.mark_price
        ?? position?.markPrice
        ?? position?.index_price
        ?? position?.oracle_price
        ?? 0,
    ) || 0;
    const margin = Number(position?.margin ?? 0) || 0;
    const funding = Number(options?.priceRow?.funding ?? position?.funding ?? 0) || 0;
    const notionalUsd = markPrice > 0 ? markPrice * amount : entryPrice * amount;
    const referenceBase = margin > 0 ? margin : entryPrice * amount;
    const sideMultiplier = side === "SHORT" ? -1 : 1;
    const unrealizedPnlUsd = (markPrice > 0 && entryPrice > 0 && side)
        ? (markPrice - entryPrice) * amount * sideMultiplier
        : 0;
    const unrealizedPnlPct = referenceBase > 0
        ? (unrealizedPnlUsd / referenceBase) * 100
        : 0;
    const positionOrders = Array.isArray(options?.orders) ? options!.orders : [];
    const takeProfitPrice = pickBracketPrice(side, entryPrice, positionOrders, "tp");
    const stopLossPrice = pickBracketPrice(side, entryPrice, positionOrders, "sl");
    const liquidationPrice = Number(
        position?.liquidation_price
        ?? position?.liquidationPrice
        ?? position?.liq_price
        ?? 0,
    ) || 0;

    return {
        symbol,
        side,
        amount,
        entryPrice,
        markPrice,
        funding,
        margin,
        isolated: Boolean(position?.isolated),
        liquidationPrice,
        takeProfitPrice,
        stopLossPrice,
        notionalUsd,
        unrealizedPnlUsd,
        unrealizedPnlPct,
        openOrderCount: positionOrders.length,
        createdAt: Number(position?.created_at ?? 0) || 0,
        updatedAt: Number(position?.updated_at ?? 0) || 0,
        raw: position,
    };
}

function mapPacificaAccountSnapshot(snapshot: any) {
    const data = snapshot?.data ?? snapshot ?? {};
    const toNumber = (value: unknown) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 0;
    };

    return {
        balance: toNumber(data?.balance),
        feeLevel: Number(data?.fee_level ?? data?.feeLevel ?? 0) || 0,
        makerFee: toNumber(data?.maker_fee ?? data?.makerFee),
        takerFee: toNumber(data?.taker_fee ?? data?.takerFee),
        equity: toNumber(data?.account_equity ?? data?.equity ?? data?.balance),
        availableToSpend: toNumber(data?.available_to_spend ?? data?.availableToSpend),
        availableToWithdraw: Math.max(0, toNumber(data?.available_to_withdraw ?? data?.availableToWithdraw)),
        pendingBalance: toNumber(data?.pending_balance ?? data?.pendingBalance),
        totalMarginUsed: toNumber(data?.total_margin_used ?? data?.totalMarginUsed),
        crossMmr: toNumber(data?.cross_mmr ?? data?.crossMmr),
        positionsCount: Number(data?.positions_count ?? data?.positionsCount ?? 0) || 0,
        ordersCount: Number(data?.orders_count ?? data?.ordersCount ?? 0) || 0,
        stopOrdersCount: Number(data?.stop_orders_count ?? data?.stopOrdersCount ?? 0) || 0,
        updatedAt: Number(data?.updated_at ?? data?.updatedAt ?? 0) || 0,
        raw: data,
    };
}

function isPacificaAccountMissingError(error: unknown) {
    const message = String((error as { message?: unknown } | null | undefined)?.message || '');
    return /Pacifica GET \/api\/v1\/account\?account=/i.test(message)
        && /\b404\b/.test(message)
        && /Account not found/i.test(message);
}

const PACIFICA_MIN_DEPOSIT_USD = Math.max(0, Number(envValue('PACIFICA_MIN_DEPOSIT_USD', '10')));
const AIRIFICA_PACIFICA_CONTEXT_CACHE_MS = Math.max(1000, Number(envValue('PACIFICA_CONTEXT_CACHE_MS', '5000')));
const AIRIFICA_PACIFICA_CONTEXT_IDLE_MS = Math.max(30_000, Number(envValue('PACIFICA_CONTEXT_IDLE_MS', '120000')));

function parseFeeRate(raw: unknown) {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : null;
}

function findBuilderApproval(
    approvals: PacificaBuilderApproval[],
    builderCode: string,
) {
    const normalizedBuilderCode = builderCode.trim().toLowerCase();
    return approvals.find(approval => String(approval?.builder_code || '').trim().toLowerCase() === normalizedBuilderCode) || null;
}

function buildBuilderApprovalHint(builderCode: string, requiredMaxFeeRate: string, currentMaxFeeRate?: string | null) {
    if (currentMaxFeeRate) {
        return `Pacifica approved ${builderCode} with max_fee_rate ${currentMaxFeeRate}, but Airifica requires at least ${requiredMaxFeeRate}. Run Complete Pacifica onboarding again and sign the updated approval.`;
    }

    return `Pacifica builder approval missing for ${builderCode}. Run Complete Pacifica onboarding again and sign the builder approval request.`;
}

function isPacificaBetaAccessError(message: string) {
    return /beta access required/i.test(message)
        || /redeem a valid beta code/i.test(message);
}

function buildPacificaBetaAccessHint() {
    return "Open Pacifica Portfolio, redeem a valid beta code for this signer, then retry execution.";
}

function buildBindingStatus(binding: ReturnType<AirificaStateStore["getBinding"]>) {
    if (!binding) {
        return {
            hasBinding: false,
            builderApproved: false,
            agentBound: false,
            isActive: false,
            readyToExecute: false,
        };
    }

    return {
        hasBinding: true,
        builderApproved: !!binding.builderApprovedAt,
        agentBound: !!binding.agentBoundAt,
        isActive: !!binding.isActive,
        readyToExecute: !!binding.isActive && !!binding.builderApprovedAt && !!binding.agentBoundAt,
        agentWalletPublicKey: binding.agentWalletPublicKey,
        pacificaAccount: binding.pacificaAccount,
        builderCode: binding.builderCode,
    };
}

function extractPacificaOrderId(result: unknown) {
    const payload = result as {
        order_id?: unknown;
        id?: unknown;
        data?: { order_id?: unknown } | null;
    } | null | undefined;

    const candidate = payload?.order_id ?? payload?.id ?? payload?.data?.order_id;
    if (candidate == null)
        return null;

    return String(candidate);
}

async function readSpotTokenBalance(walletAddress: string, mintAddress: string) {
    if (!solanaConnection || !isValidSolanaAddress(walletAddress) || !isValidSolanaAddress(mintAddress))
        return null;

    try {
        const owner = new PublicKey(walletAddress);
        const mint = new PublicKey(mintAddress);
        const accounts = await solanaConnection.getParsedTokenAccountsByOwner(owner, { mint });
        let quantity = 0;
        let decimals = 0;

        for (const account of accounts.value) {
            const tokenAmount = (account.account.data as any)?.parsed?.info?.tokenAmount;
            const uiAmountString = tokenAmount?.uiAmountString ?? tokenAmount?.uiAmount ?? "0";
            const numeric = Number(uiAmountString);
            if (Number.isFinite(numeric))
                quantity += numeric;
            const parsedDecimals = Number(tokenAmount?.decimals);
            if (Number.isFinite(parsedDecimals))
                decimals = parsedDecimals;
        }

        return {
            quantity,
            decimals,
        };
    } catch (error) {
        elizaLogger.warn("[client-airifica] onchain token balance lookup failed:", {
            walletAddress,
            mintAddress,
            error,
        });
        return null;
    }
}

async function discoverWalletTokenBalances(walletAddress: string) {
    if (!solanaConnection || !isValidSolanaAddress(walletAddress))
        return [];

    try {
        const owner = new PublicKey(walletAddress);
        const accounts = await solanaConnection.getParsedTokenAccountsByOwner(owner, { programId: SOLANA_TOKEN_PROGRAM_ID });
        const balances = new Map<string, { mintAddress: string; quantity: number; decimals: number }>();

        for (const account of accounts.value) {
            const parsedInfo = (account.account.data as any)?.parsed?.info;
            const mintAddress = String(parsedInfo?.mint || "").trim();
            if (!mintAddress || ONCHAIN_SPOT_EXCLUDED_MINTS.has(mintAddress))
                continue;
            const tokenAmount = parsedInfo?.tokenAmount;
            const quantity = Number(tokenAmount?.uiAmountString ?? tokenAmount?.uiAmount ?? 0);
            if (!Number.isFinite(quantity) || quantity <= 0)
                continue;
            const decimals = Number(tokenAmount?.decimals);
            const existing = balances.get(mintAddress);
            balances.set(mintAddress, {
                mintAddress,
                quantity: Number(existing?.quantity || 0) + quantity,
                decimals: Number.isFinite(decimals) ? decimals : Number(existing?.decimals || 0),
            });
        }

        return Array.from(balances.values())
            .sort((left, right) => right.quantity - left.quantity);
    } catch (error) {
        elizaLogger.warn("[client-airifica] wallet token discovery failed:", {
            walletAddress,
            error,
        });
        return [];
    }
}

function sanitizePacificaKnowledgePayload(overview: {
    status: Record<string, unknown>;
    account: ReturnType<typeof mapPacificaAccountSnapshot> | null;
    positions: ReturnType<typeof mapPacificaPosition>[];
    onchainPositions?: Array<{
        symbol: string;
        mintAddress: string;
        quantity: number;
        priceUsd: number | null;
        valueUsd: number | null;
        provider: string | null;
        updatedAt: number;
    }>;
    accountMissing?: boolean;
    minimumDepositUsd?: number | null;
    onboardingHint?: string | null;
}) {
    return {
        pacifica_status: overview.status,
        pacifica_account: overview.account
            ? {
                equity_usd: overview.account.equity,
                fee_level: overview.account.feeLevel,
                maker_fee_rate: overview.account.makerFee,
                taker_fee_rate: overview.account.takerFee,
                available_to_spend_usd: overview.account.availableToSpend,
                available_to_withdraw_usd: overview.account.availableToWithdraw,
                pending_balance_usd: overview.account.pendingBalance,
                total_margin_used_usd: overview.account.totalMarginUsed,
                cross_mmr_usd: overview.account.crossMmr,
                positions_count: overview.account.positionsCount,
                orders_count: overview.account.ordersCount,
                stop_orders_count: overview.account.stopOrdersCount,
                updated_at: overview.account.updatedAt,
            }
            : null,
        account_missing: Boolean(overview.accountMissing),
        onboarding_hint: overview.onboardingHint || null,
        minimum_deposit_usd: overview.minimumDepositUsd ?? PACIFICA_MIN_DEPOSIT_USD,
        open_positions: overview.positions.map(position => ({
            symbol: position.symbol,
            side: position.side,
            amount: position.amount,
            entry_price: position.entryPrice,
            mark_price: position.markPrice,
            take_profit_price: position.takeProfitPrice,
            stop_loss_price: position.stopLossPrice,
            liquidation_price: position.liquidationPrice,
            notional_usd: position.notionalUsd,
            margin_usd: position.margin,
            funding_rate: position.funding,
            unrealized_pnl_usd: position.unrealizedPnlUsd,
            unrealized_pnl_pct: position.unrealizedPnlPct,
            isolated: position.isolated,
            updated_at: position.updatedAt,
        })),
        onchain_positions: Array.isArray(overview.onchainPositions)
            ? overview.onchainPositions.map(position => ({
                symbol: position.symbol,
                mint_address: position.mintAddress,
                quantity: position.quantity,
                price_usd: position.priceUsd,
                value_usd: position.valueUsd,
                provider: position.provider,
                updated_at: position.updatedAt,
            }))
            : [],
    };
}

/**
 * HTTP + WebSocket server for the Airifica client.
 *
 * Endpoints:
 *   POST  /api/airi3/session      — create or resume a session
 *   POST  /api/airi3/message      — send a message, receive response(s)
 *   GET   /api/airi3/history      — get recent conversation history
 *   WS    /api/airi3/ws           — optional streaming channel
 */
export class AirificaServer {
    private app: express.Application;
    private httpServer: http.Server;
    private wss: WebSocketServer;
    private messageManager: AirificaMessageManager;
    private stateStore: AirificaStateStore;
    private wsClients: Map<string, ConnectedClient & { ws: WebSocket }> = new Map();
    private port: number;
    private marketUniverseWarmTimer?: NodeJS.Timeout;
    /** Persistent conversation ID per wallet for the OpenAI-compatible endpoint */
    private walletConvMap: Map<string, string> = new Map();

    constructor(runtime: IAgentRuntime, port = DEFAULT_PORT) {
        this.port = port;
        this.messageManager = new AirificaMessageManager(runtime);
        this.stateStore = new AirificaStateStore();
        this.app = express();
        this.httpServer = http.createServer(this.app);
        this.wss = new WebSocketServer({ server: this.httpServer, path: "/api/airi3/ws" });

        this.setupMiddleware();
        this.setupRoutes();
        this.setupWs();
        this.startMarketUniverseWarmLoop();
    }

    private startMarketUniverseWarmLoop() {
        const warm = async () => {
            try {
                await primePacificaMarketUniverse();
            } catch (error) {
                elizaLogger.warn("[client-airifica] market universe warm failed:", error);
            }
        };

        void warm();
        this.marketUniverseWarmTimer = setInterval(() => {
            void warm();
        }, PACIFICA_UNIVERSE_WARM_MS);
    }

    private setupMiddleware() {
        assertSecurityConfiguration();
        this.app.disable("x-powered-by");
        this.app.use((_req, res, next) => {
            applySecurityHeaders(res);
            next();
        });
        this.app.use(cors({
            origin(origin, callback) {
                if (isAllowedCorsOrigin(origin))
                    callback(null, true);
                else
                    callback(new Error("CORS origin not allowed"));
            },
            credentials: true,
        }));
        this.app.use(express.json({ limit: MAX_JSON_BODY }));
    }

    private setupRoutes() {
        this.app.post("/api/auth/challenge", async (req: Request, res: Response) => {
            try {
                pruneNonces();
                const { address } = req.body ?? {};
                if (!address) {
                    res.status(400).json({ error: "address required" });
                    return;
                }
                if (!isValidSolanaAddress(address)) {
                    res.status(400).json({ error: "Invalid Solana address" });
                    return;
                }

                const normalized = String(address).trim();
                const nonce = createNonce(normalized);
                res.json({ message: buildSolanaAuthMessage(normalized, nonce, getPublicAppHost(req)) });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/auth/challenge error:", err);
                res.status(500).json({ error: err?.message || "Failed to create challenge" });
            }
        });

        this.app.post("/api/auth/verify", async (req: Request, res: Response) => {
            try {
                pruneNonces();
                const { message, signature, address } = req.body ?? {};
                if (!message || !signature || !address) {
                    res.status(400).json({ error: "message, signature, address required" });
                    return;
                }
                if (!isValidSolanaAddress(address)) {
                    res.status(400).json({ error: "Invalid Solana address" });
                    return;
                }

                const parsed = parseSolanaAuthMessage(message);
                if (!parsed || parsed.address !== address) {
                    res.status(400).json({ error: "Invalid authentication message" });
                    return;
                }
                if (!consumeNonce(parsed.nonce, address)) {
                    res.status(401).json({ error: "Invalid or expired nonce" });
                    return;
                }
                if (!verifySolanaSignature(address, message, signature)) {
                    res.status(401).json({ error: "Signature verification failed" });
                    return;
                }

                const admin = isAdminWallet(address);
                this.stateStore.touchUser(address, {
                    verified: true,
                    isAdmin: admin,
                    source: "wallet_auth",
                });

                res.json({
                    token: signAuthToken(address, admin),
                    user: {
                        id: 0,
                        address,
                        isAdmin: admin,
                    },
                });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/auth/verify error:", err);
                res.status(500).json({ error: err?.message || "Verification failed" });
            }
        });

        const requireAuth = (req: Request, res: Response) => {
            try {
                const authorization = req.headers.authorization || "";
                const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
                if (!token) {
                    res.status(401).json({ error: "Missing token" });
                    return null;
                }
                const payload = verifyAuthToken(token);
                return {
                    ...payload,
                    isAdmin: payload.isAdmin || isAdminWallet(payload.address),
                };
            } catch {
                res.status(401).json({ error: "Unauthorized" });
                return null;
            }
        };

        const maybeAuth = (req: Request) => {
            try {
                const authorization = req.headers.authorization || "";
                const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
                if (!token)
                    return null;
                const payload = verifyAuthToken(token);
                return {
                    ...payload,
                    isAdmin: payload.isAdmin || isAdminWallet(payload.address),
                };
            } catch {
                return null;
            }
        };

        const requireAdmin = (req: Request, res: Response) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return null;
            if (!auth.isAdmin) {
                res.status(403).json({ ok: false, error: "Admin access required" });
                return null;
            }
            return auth;
        };

        const requireTelegramInternal = (req: Request, res: Response) => {
            if (!AIRIFICA_TELEGRAM_INTERNAL_SECRET) {
                res.status(503).json({ ok: false, error: "Telegram integration is not configured" });
                return false;
            }

            const provided = String(
                req.headers["x-airifica-internal-secret"]
                || req.headers.authorization?.toString().replace(/^Bearer\s+/i, "")
                || "",
            ).trim();

            if (!provided || provided !== AIRIFICA_TELEGRAM_INTERNAL_SECRET) {
                res.status(401).json({ ok: false, error: "Unauthorized" });
                return false;
            }

            return true;
        };

        const buildTelegramDeepLink = (code: string) => {
            if (!AIRIFICA_TELEGRAM_BOT_USERNAME)
                return null;
            return `https://t.me/${AIRIFICA_TELEGRAM_BOT_USERNAME}?start=link_${code}`;
        };

        const buildTelegramTradeAlertText = (payload: {
            venue?: string | null;
            symbol: string;
            side?: string | null;
            amountUsd?: number | null;
            quantity?: number | null;
            txSignature?: string | null;
            explorerUrl?: string | null;
        }) => {
            const venue = String(payload.venue || "frontend").trim();
            const symbol = normalizeSymbol(payload.symbol || "");
            const side = normalizePacificaSide(payload.side || "", null) || String(payload.side || "").trim().toUpperCase() || "TRADE";
            const amountUsd = Number(payload.amountUsd);
            const quantity = Number(payload.quantity);
            const isJupiter = /jupiter/i.test(venue);
            const lines = [
                `Opened ${side} ${symbol}${venue ? ` via ${venue}` : ""}.`,
            ];

            const facts: string[] = [];
            if (Number.isFinite(amountUsd) && amountUsd > 0)
                facts.push(`Notional: ${amountUsd.toFixed(2)} USD`);
            if (Number.isFinite(quantity) && quantity > 0)
                facts.push(`Size: ${quantity.toFixed(6)}`);
            if (facts.length)
                lines.push(facts.join(" · "));

            if (isJupiter)
                lines.push("TP/SL levels remain analytical only for spot swaps.");

            if (payload.explorerUrl) {
                lines.push(payload.explorerUrl);
            } else if (payload.txSignature) {
                lines.push(`https://solscan.io/tx/${payload.txSignature}`);
            }

            if (AIRIFICA_TELEGRAM_NOTIFY_BASE_URL)
                lines.push(AIRIFICA_TELEGRAM_NOTIFY_BASE_URL);

            return compact(lines.join("\n"));
        };

        const requirePacificaExecutionContext = async (walletAddress: string) => {
            const binding = this.stateStore.getBinding(walletAddress);
            if (!binding) {
                throw new Error("Pacifica onboarding incomplete: no agent binding found.");
            }
            if (!binding.isActive || !binding.builderApprovedAt || !binding.agentBoundAt) {
                throw new Error("Pacifica onboarding incomplete: builder approval or agent binding still missing.");
            }
            if (!AIRIFICA_ENCRYPTION_KEY) {
                throw new Error("AIRIFICA_ENCRYPTION_KEY not configured");
            }

            const ctx: PacificaRequestContext = {
                account: binding.pacificaAccount,
                agentWalletPublicKey: binding.agentWalletPublicKey,
                agentWalletPrivateKeyPkcs8Base64: decryptAgentPrivateKey(binding.encryptedAgentWalletPrivateKey, AIRIFICA_ENCRYPTION_KEY),
                builderCode: binding.builderCode,
                apiBase: PACIFICA_API_BASE,
                expiryWindowMs: PACIFICA_EXPIRY_MS,
                apiKey: PACIFICA_API_KEY,
            };

            return { binding, ctx };
        };

        const fetchBuilderApprovalState = async (ctx: Pick<PacificaRequestContext, 'account' | 'apiBase' | 'apiKey' | 'builderCode'>) => {
            const approvals = await fetchBuilderApprovalsForAccount(ctx);
            const approval = findBuilderApproval(approvals, ctx.builderCode);
            const requiredFeeRate = parseFeeRate(PACIFICA_BUILDER_MAX_FEE_RATE);
            const currentFeeRate = parseFeeRate(approval?.max_fee_rate);
            const hasSufficientFeeCap = requiredFeeRate == null || (currentFeeRate != null && currentFeeRate >= requiredFeeRate);

            return {
                approvals,
                approval,
                hasApproval: Boolean(approval),
                hasSufficientFeeCap,
                hint: buildBuilderApprovalHint(ctx.builderCode, PACIFICA_BUILDER_MAX_FEE_RATE, approval?.max_fee_rate || null),
            };
        };

        type PacificaKnowledgeCacheEntry = {
            updatedAt: number;
            lastAccessAt: number;
            knowledge: string | null;
            refreshPromise: Promise<string | null> | null;
            timer: NodeJS.Timeout | null;
        };

        const pacificaKnowledgeCache = new Map<string, PacificaKnowledgeCacheEntry>();

        const getOrCreatePacificaKnowledgeEntry = (walletAddress: string) => {
            let entry = pacificaKnowledgeCache.get(walletAddress);
            if (entry)
                return entry;

            entry = {
                updatedAt: 0,
                lastAccessAt: Date.now(),
                knowledge: null,
                refreshPromise: null,
                timer: null,
            };
            pacificaKnowledgeCache.set(walletAddress, entry);
            return entry;
        };

        const buildPacificaOverview = async (walletAddress: string) => {
            const binding = this.stateStore.getBinding(walletAddress);
            const localStatus = buildBindingStatus(binding);
            let builderApprovalState: Awaited<ReturnType<typeof fetchBuilderApprovalState>> | null = null;

            if (binding && localStatus.readyToExecute) {
                builderApprovalState = await fetchBuilderApprovalState({
                    account: binding.pacificaAccount,
                    apiBase: PACIFICA_API_BASE,
                    apiKey: PACIFICA_API_KEY,
                    builderCode: binding.builderCode,
                });
            }

            const status = builderApprovalState && (!builderApprovalState.hasApproval || !builderApprovalState.hasSufficientFeeCap)
                ? {
                    ...localStatus,
                    readyToExecute: false,
                }
                : localStatus;
            const onchainPositions = await buildOnchainSpotPositions(walletAddress);

            if (!binding || !status.readyToExecute) {
                return {
                    ok: true,
                    status,
                    account: null,
                    positions: [],
                    onchainPositions,
                    accountMissing: false,
                    minimumDepositUsd: PACIFICA_MIN_DEPOSIT_USD,
                    onboardingHint: builderApprovalState && (!builderApprovalState.hasApproval || !builderApprovalState.hasSufficientFeeCap)
                        ? builderApprovalState.hint
                        : null,
                };
            }

            const ctx = {
                account: binding.pacificaAccount,
                apiBase: PACIFICA_API_BASE,
                apiKey: PACIFICA_API_KEY,
            };

            let accountSnapshot: any;
            try {
                accountSnapshot = await fetchAccountSnapshotForAccount(ctx);
            } catch (err: any) {
                if (isPacificaAccountMissingError(err)) {
                    return {
                        ok: true,
                        status,
                        account: null,
                        positions: [],
                        onchainPositions,
                        accountMissing: true,
                        minimumDepositUsd: PACIFICA_MIN_DEPOSIT_USD,
                        onboardingHint: `Open Pacifica with AIRewardrop and deposit at least ${PACIFICA_MIN_DEPOSIT_USD} USDC to initialize this account.`,
                    };
                }
                throw err;
            }

            const [positionsPayload, ordersPayload, priceRows] = await Promise.all([
                fetchPositionsForAccount(ctx),
                fetchOrdersForAccount(ctx),
                fetchPriceRows(ctx),
            ]);

            const ordersBySymbol = new Map<string, any[]>();
            for (const order of ordersPayload) {
                const symbol = normalizeOrderSymbol(order);
                if (!symbol)
                    continue;
                const bucket = ordersBySymbol.get(symbol) || [];
                bucket.push(order);
                ordersBySymbol.set(symbol, bucket);
            }

            const priceRowsBySymbol = new Map<string, PacificaPriceRow>();
            for (const row of priceRows) {
                const symbol = normalizeSymbol(row?.symbol);
                if (symbol)
                    priceRowsBySymbol.set(symbol, row);
            }

            const positions = positionsPayload
                .map(position => mapPacificaPosition(position, {
                    orders: ordersBySymbol.get(normalizeSymbol(position?.symbol ?? position?.market ?? position?.ticker)) || [],
                    priceRow: priceRowsBySymbol.get(normalizeSymbol(position?.symbol ?? position?.market ?? position?.ticker)) || null,
                }))
                .filter(position => position.symbol && position.side && position.amount > 0);

            return {
                ok: true,
                status,
                account: mapPacificaAccountSnapshot(accountSnapshot),
                positions,
                onchainPositions,
                accountMissing: false,
                minimumDepositUsd: PACIFICA_MIN_DEPOSIT_USD,
                onboardingHint: null,
            };
        };

        const buildOnchainSpotPositions = async (walletAddress: string) => {
            const watches = this.stateStore.listOnchainSpotWatchesForWallet(walletAddress);
            const discoveredBalances = await discoverWalletTokenBalances(walletAddress);
            if (!watches.length && !discoveredBalances.length)
                return [];

            const watchByMint = new Map(watches.map(watch => [watch.mintAddress, watch]));
            const candidateMints = new Set<string>([
                ...watches.map(watch => watch.mintAddress),
                ...discoveredBalances.map(balance => balance.mintAddress),
            ]);

            const positions = await Promise.all(Array.from(candidateMints).map(async (mintAddress) => {
                if (!mintAddress)
                    return null;

                const watch = watchByMint.get(mintAddress) || null;
                const discoveredBalance = discoveredBalances.find(balance => balance.mintAddress === mintAddress) || null;
                const balance = discoveredBalance || await readSpotTokenBalance(walletAddress, mintAddress);
                const quantity = Number(balance?.quantity || 0);

                let market: Awaited<ReturnType<typeof fetchMarketContext>> | null = null;
                try {
                    market = await fetchMarketContext(watch?.marketQuery || mintAddress, "15m", 96);
                } catch (error) {
                    elizaLogger.warn("[client-airifica] onchain market context lookup skipped:", {
                        walletAddress,
                        mintAddress,
                        error,
                    });
                }
                const priceUsd = Number(market?.price);
                const normalizedPrice = Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : null;
                const syncedWatch = this.stateStore.syncOnchainSpotHolding(walletAddress, mintAddress, {
                    symbol: market?.symbol || watch?.symbol || null,
                    marketQuery: watch?.marketQuery || market?.requestQuery || mintAddress,
                    quantity,
                    priceUsd: normalizedPrice,
                    txSignature: watch?.lastTxSignature || null,
                });

                if (!Number.isFinite(quantity) || quantity <= 0)
                    return null;

                const valueUsd = normalizedPrice != null ? normalizedPrice * quantity : null;
                const costBasisUsd = Number(syncedWatch.costBasisUsd || 0);
                const unrealizedPnlUsd = valueUsd != null && costBasisUsd > 0 ? valueUsd - costBasisUsd : null;
                const fallbackSymbol = syncedWatch.symbol || watch?.symbol || `${mintAddress.slice(0, 4)}…${mintAddress.slice(-4)}`;

                return {
                    symbol: market?.symbol || fallbackSymbol,
                    mintAddress,
                    quantity,
                    decimals: Number(balance?.decimals || 0),
                    priceUsd: normalizedPrice,
                    valueUsd,
                    costBasisUsd: costBasisUsd > 0 ? costBasisUsd : null,
                    unrealizedPnlUsd,
                    realizedPnlUsd: Number.isFinite(Number(syncedWatch.realizedPnlUsd || 0)) ? Number(syncedWatch.realizedPnlUsd || 0) : null,
                    provider: market?.provider || null,
                    marketQuery: syncedWatch.marketQuery || watch?.marketQuery || mintAddress,
                    lastTradeAt: syncedWatch.lastTradeAt || watch?.lastTradeAt || watch?.updatedAt || Date.now(),
                    lastTxSignature: syncedWatch.lastTxSignature || watch?.lastTxSignature || null,
                    updatedAt: syncedWatch.updatedAt || watch?.updatedAt || Date.now(),
                };
            }));

            return positions
                .filter((position): position is NonNullable<typeof position> => Boolean(position))
                .sort((left, right) => {
                    const valueDelta = Number(right.valueUsd || 0) - Number(left.valueUsd || 0);
                    if (valueDelta !== 0)
                        return valueDelta;
                    return Number(right.updatedAt || 0) - Number(left.updatedAt || 0);
                });
        };

        const closePacificaPositionForWallet = async (
            walletAddress: string,
            input: { symbol: string; side?: "LONG" | "SHORT" | null; amount?: number | null },
            executionSource: "web" | "telegram" = "web",
        ) => {
            const symbol = normalizeSymbol(input.symbol);
            if (!symbol)
                throw new Error("symbol required");

            const requestedSide = input.side || null;
            const requestedAmount = normalizeAmount(input.amount);
            const { ctx } = await requirePacificaExecutionContext(walletAddress);
            const positionsPayload = await fetchPositionsForAccount({
                account: ctx.account,
                apiBase: ctx.apiBase,
                apiKey: ctx.apiKey,
            });
            const positions = positionsPayload
                .map(mapPacificaPosition)
                .filter(position => position.symbol === symbol && position.side && position.amount > 0);

            const targetPosition = requestedSide
                ? positions.find(position => position.side === requestedSide)
                : positions[0];
            if (!targetPosition || !targetPosition.side)
                throw new Error(`No open Pacifica position found for ${symbol}`);

            const amountToClose = requestedAmount > 0 ? Math.min(requestedAmount, targetPosition.amount) : targetPosition.amount;
            if (!Number.isFinite(amountToClose) || amountToClose <= 0)
                throw new Error("Invalid close amount");
            const realizedPnlUsd = targetPosition.markPrice > 0 && targetPosition.entryPrice > 0
                ? (targetPosition.markPrice - targetPosition.entryPrice) * amountToClose * (targetPosition.side === "SHORT" ? -1 : 1)
                : 0;
            const closeNotionalUsd = targetPosition.markPrice > 0 ? targetPosition.markPrice * amountToClose : targetPosition.entryPrice * amountToClose;

            const closeSide = targetPosition.side === "LONG" ? "ask" : "bid";
            const orderResult = await createMarketOrderForContext(ctx, {
                symbol,
                side: closeSide,
                size: amountToClose,
                reduce_only: true,
            });

            return {
                symbol,
                side: targetPosition.side,
                amount: amountToClose,
                realizedPnlUsd,
                notionalUsd: closeNotionalUsd,
                orderId: extractPacificaOrderId(orderResult),
                pacificaResponse: orderResult,
                ledger: this.stateStore.appendTradeLedgerRecord({
                    walletAddress,
                    venue: "pacifica",
                    marketType: "perp",
                    symbol,
                    side: "CLOSE",
                    quantity: amountToClose,
                    notionalUsd: closeNotionalUsd,
                    marginUsd: null,
                    leverage: null,
                    realizedPnlUsd,
                    mintAddress: null,
                    orderId: extractPacificaOrderId(orderResult),
                    txSignature: null,
                    proposalId: null,
                    executionSource,
                    note: `${targetPosition.side} close`,
                }),
            };
        };

        const queueTelegramTradeAlert = (
            walletAddress: string,
            text: string,
            kind: "TRADE_OPENED" | "POSITION_CLOSED",
            meta?: Record<string, unknown> | null,
        ) => {
            try {
                this.stateStore.createTelegramNotifications(walletAddress, kind, text, meta);
            } catch (error) {
                elizaLogger.warn("[client-airifica] telegram alert queue skipped:", error);
            }
        };

        const writePacificaKnowledgeCache = (walletAddress: string, overview: Awaited<ReturnType<typeof buildPacificaOverview>>) => {
            const entry = getOrCreatePacificaKnowledgeEntry(walletAddress);
            entry.knowledge = JSON.stringify(sanitizePacificaKnowledgePayload(overview), null, 2);
            entry.updatedAt = Date.now();
            entry.lastAccessAt = Date.now();
            return entry.knowledge;
        };

        const refreshPacificaKnowledgeCache = async (walletAddress: string) => {
            const entry = getOrCreatePacificaKnowledgeEntry(walletAddress);
            entry.lastAccessAt = Date.now();
            if (entry.refreshPromise)
                return entry.refreshPromise;

            entry.refreshPromise = (async () => {
                try {
                    const overview = await buildPacificaOverview(walletAddress);
                    return writePacificaKnowledgeCache(walletAddress, overview);
                } catch (error) {
                    elizaLogger.warn("[client-airifica] Pacifica knowledge refresh skipped:", error);
                    return entry.knowledge;
                } finally {
                    const latest = pacificaKnowledgeCache.get(walletAddress);
                    if (latest)
                        latest.refreshPromise = null;
                }
            })();

            return entry.refreshPromise;
        };

        const ensurePacificaKnowledgeTicker = (walletAddress: string) => {
            const entry = getOrCreatePacificaKnowledgeEntry(walletAddress);
            entry.lastAccessAt = Date.now();
            if (entry.timer)
                return entry;

            entry.timer = setInterval(() => {
                const current = pacificaKnowledgeCache.get(walletAddress);
                if (!current)
                    return;

                if (Date.now() - current.lastAccessAt > AIRIFICA_PACIFICA_CONTEXT_IDLE_MS) {
                    if (current.timer)
                        clearInterval(current.timer);
                    pacificaKnowledgeCache.delete(walletAddress);
                    return;
                }

                void refreshPacificaKnowledgeCache(walletAddress);
            }, AIRIFICA_PACIFICA_CONTEXT_CACHE_MS);

            return entry;
        };

        const getPacificaKnowledgeSnapshot = (walletAddress: string) => {
            const entry = ensurePacificaKnowledgeTicker(walletAddress);
            if (!entry.updatedAt || (Date.now() - entry.updatedAt) > AIRIFICA_PACIFICA_CONTEXT_CACHE_MS)
                void refreshPacificaKnowledgeCache(walletAddress);

            return entry.knowledge;
        };

        const maybePrimePacificaKnowledge = async (walletAddress: string, overview?: Awaited<ReturnType<typeof buildPacificaOverview>>) => {
            try {
                ensurePacificaKnowledgeTicker(walletAddress);
                if (overview)
                    return writePacificaKnowledgeCache(walletAddress, overview);
                return await refreshPacificaKnowledgeCache(walletAddress);
            } catch (error) {
                elizaLogger.warn("[client-airifica] Pacifica knowledge prime skipped:", error);
                return null;
            }
        };

        const buildTelegramWalletSummary = async (
            walletAddress: string,
            overviewInput?: Awaited<ReturnType<typeof buildPacificaOverview>>,
        ) => {
            const overview = overviewInput || await buildPacificaOverview(walletAddress);
            await maybePrimePacificaKnowledge(walletAddress, overview);
            const account = overview.account;
            const positions = Array.isArray(overview.positions) ? overview.positions : [];
            const onchainPositions = Array.isArray((overview as any).onchainPositions) ? (overview as any).onchainPositions : [];
            const tradeLedger = this.stateStore.listTradeLedgerForWallet(walletAddress);
            const onchainWatchMap = new Map(
                this.stateStore.listOnchainSpotWatchesForWallet(walletAddress)
                    .map(item => [String(item.mintAddress || "").trim(), item]),
            );
            const realizedPnlUsd = tradeLedger.reduce((sum, item) => sum + Number(item.realizedPnlUsd || 0), 0);
            const onchainPnlUsd = onchainPositions.reduce((sum: number, position: any) => {
                const watch = onchainWatchMap.get(String(position.mintAddress || "").trim());
                if (!watch)
                    return sum;
                const lastNotionalUsd = Number(watch.costBasisUsd || 0);
                const currentValueUsd = Number(position.valueUsd || 0);
                if (!Number.isFinite(lastNotionalUsd) || lastNotionalUsd <= 0 || !Number.isFinite(currentValueUsd))
                    return sum;
                return sum + (currentValueUsd - lastNotionalUsd);
            }, 0);
            const totalPnlUsd = realizedPnlUsd + positions.reduce((sum, position) => sum + Number(position.unrealizedPnlUsd || 0), 0) + onchainPnlUsd;
            const latestTrade = tradeLedger[0] || null;
            const effectiveLatestTrade = latestTrade
                ? {
                    symbol: latestTrade.symbol,
                    side: latestTrade.side,
                    orderId: latestTrade.orderId || latestTrade.txSignature,
                    updatedAt: latestTrade.updatedAt,
                    venue: latestTrade.venue,
                }
                : null;

            return {
                walletAddress,
                equityUsd: account ? Number(account.equity || 0) : 0,
                availableUsd: account ? Number(account.availableToSpend || 0) : 0,
                withdrawableUsd: account ? Number(account.availableToWithdraw || 0) : 0,
                positionsCount: positions.length,
                onchainPositionsCount: onchainPositions.length,
                onchainValueUsd: onchainPositions.reduce((sum: number, position: any) => sum + Number(position.valueUsd || 0), 0),
                realizedPnlUsd,
                totalPnlUsd,
                latestTrade: effectiveLatestTrade,
            };
        };

        const buildTelegramTradeHistory = async (
            walletAddress: string,
            overviewInput?: Awaited<ReturnType<typeof buildPacificaOverview>>,
        ) => {
            const overview = overviewInput || await buildPacificaOverview(walletAddress);
            const livePerpPnlByKey = new Map(
                (Array.isArray(overview.positions) ? overview.positions : []).map(position => [
                    `${String(position.symbol || "").toUpperCase()}:${String(position.side || "").toUpperCase()}`,
                    Number(position.unrealizedPnlUsd || 0),
                ]),
            );
            const liveSpotPnlByMint = new Map(
                (Array.isArray((overview as any).onchainPositions) ? (overview as any).onchainPositions : []).map((position: any) => [
                    String(position.mintAddress || "").trim(),
                    position.unrealizedPnlUsd == null ? null : Number(position.unrealizedPnlUsd || 0),
                ]),
            );
            const ledger = this.stateStore.listTradeLedgerForWallet(walletAddress);
            const seenProposalIds = new Set(
                ledger
                    .map(item => Number(item.proposalId || 0))
                    .filter(value => Number.isFinite(value) && value > 0),
            );
            const legacyExecuted = this.stateStore.listProposals()
                .filter(proposal => proposal.walletAddress === walletAddress && proposal.status === "EXECUTED" && !seenProposalIds.has(proposal.id))
                .map((proposal) => ({
                    id: proposal.id,
                    symbol: proposal.proposal.symbol,
                    side: proposal.proposal.side,
                    venue: proposal.executionVenue || "pacifica",
                    orderId: proposal.orderId,
                    notionalUsd: Number(proposal.executedNotionalUsd || 0),
                    marginUsd: Number(proposal.executedMarginUsd || 0),
                    leverage: Number(proposal.executedLeverage || 1),
                    realizedPnlUsd: null,
                    currentPnlUsd: livePerpPnlByKey.get(`${String(proposal.proposal.symbol || "").toUpperCase()}:${String(proposal.proposal.side || "").toUpperCase()}`) ?? null,
                    updatedAt: Number(proposal.executedAt || proposal.updatedAt || Date.now()),
                }));

            return [
                ...ledger.map(item => ({
                    id: item.id,
                    symbol: item.symbol,
                    side: item.side,
                    venue: item.venue,
                    orderId: item.orderId || item.txSignature,
                    notionalUsd: Number(item.notionalUsd || 0),
                    marginUsd: Number(item.marginUsd || 0),
                    leverage: Number(item.leverage || 1),
                    realizedPnlUsd: item.realizedPnlUsd == null ? null : Number(item.realizedPnlUsd),
                    currentPnlUsd: item.marketType === "perp"
                        ? livePerpPnlByKey.get(`${String(item.symbol || "").toUpperCase()}:${String(item.side || "").toUpperCase()}`) ?? null
                        : (item.mintAddress ? liveSpotPnlByMint.get(String(item.mintAddress || "").trim()) ?? null : null),
                    updatedAt: Number(item.updatedAt || item.createdAt || Date.now()),
                })),
                ...legacyExecuted,
            ]
                .sort((left, right) => right.updatedAt - left.updatedAt)
                .slice(0, 20);
        };

        const STOPWORD_TICKERS = new Set([
            "HOW",
            "ARE",
            "YOU",
            "WHAT",
            "SHOW",
            "ME",
            "THE",
            "FOR",
            "AND",
            "WITH",
            "FROM",
            "THIS",
            "THAT",
            "PLEASE",
            "PRICE",
            "CHART",
            "ANALYSIS",
            "FUNDAMENTALS",
            "FUNDAMENTAL",
            "NEWS",
            "SENTIMENT",
            "VOLUME",
            "LISTINGS",
            "TRENDING",
            "TOKEN",
            "TOKENS",
            "MENTIONED",
            "BOOSTED",
            "OPEN",
            "POSITION",
            "POSITIONS",
            "CLOSE",
            "LONG",
            "SHORT",
            "ACCOUNT",
            "EQUITY",
            "AVAILABLE",
            "WITHDRAWABLE",
        ]);

        const extractIdentifiersFromText = (text: string) => {
            const raw = String(text || "").trim();
            const contractAddresses = Array.from(new Set(
                Array.from(raw.matchAll(/\b(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{25,60})\b/g))
                    .map(match => normalizeMarketContextQuery(match[1]))
                    .filter(Boolean),
            ));

            const explicitTickers = new Set<string>();
            for (const match of raw.matchAll(/\$([a-zA-Z0-9]{2,12})\b/g)) {
                const normalized = normalizeMarketContextQuery(match[1]);
                if (normalized)
                    explicitTickers.add(normalized);
            }

            for (const match of raw.matchAll(/\b(?:price|chart|analysis|fundamentals|fundamental|news|sentiment|for|of|about|on)\s+\$?([a-zA-Z0-9]{2,12})\b/gi)) {
                const normalized = normalizeMarketContextQuery(match[1]);
                if (normalized && !STOPWORD_TICKERS.has(normalized))
                    explicitTickers.add(normalized);
            }

            if (!contractAddresses.length) {
                const tokens = raw.match(/\b[a-zA-Z]{2,12}\b/g) || [];
                if (tokens.length === 1) {
                    const normalized = normalizeMarketContextQuery(tokens[0]);
                    if (normalized && !STOPWORD_TICKERS.has(normalized))
                        explicitTickers.add(normalized);
                }
            }

            return {
                contractAddresses,
                tickers: Array.from(explicitTickers),
            };
        };

        const trackPromptAnalytics = (walletAddress: string, source: string, text: string) => {
            this.stateStore.touchUser(walletAddress, { source });
            this.stateStore.incrementCounter("request_source", source);

            const identifiers = extractIdentifiersFromText(text);
            identifiers.tickers.forEach((ticker) => {
                this.stateStore.incrementCounter("requested_ticker", ticker);
            });
            identifiers.contractAddresses.forEach((address) => {
                this.stateStore.incrementCounter("requested_contract", address);
            });
        };

        const trackTradeExecutionCounters = (payload: {
            venue: string;
            symbol: string;
            notionalUsd: number;
            source: string;
        }) => {
            this.stateStore.incrementCounter("trade_count", payload.venue);
            this.stateStore.incrementCounter("trade_source", payload.source);
            this.stateStore.incrementCounter("trade_symbol", payload.symbol);
            if (Number.isFinite(payload.notionalUsd) && payload.notionalUsd > 0)
                this.stateStore.incrementCounter("trade_volume_usd", payload.venue, payload.notionalUsd);
        };

        const topCounters = (prefix: string, limit = 8) =>
            this.stateStore.listCounters(prefix)
                .slice(0, limit)
                .map((counter) => ({
                    key: counter.key.slice(prefix.length + 1),
                    count: counter.count,
                    updatedAt: counter.updatedAt,
                }));

        const buildAdminOverview = async () => {
            const users = this.stateStore.listUsers();
            const bindings = this.stateStore.listBindings();
            const proposals = this.stateStore.listProposals();
            const telegramLinks = this.stateStore.listTelegramLinks();
            const notifications = this.stateStore.listTelegramNotifications();
            const telegramHeartbeat = this.stateStore.getRuntimeHeartbeat("telegram");
            let marketUniverseCount = 0;

            try {
                marketUniverseCount = (await fetchPacificaMarketUniverse()).length;
            } catch {
            }

            const executedProposals = proposals.filter(proposal => proposal.status === "EXECUTED");
            const proposalStatusCounts = proposals.reduce<Record<string, number>>((acc, proposal) => {
                acc[proposal.status] = Number(acc[proposal.status] || 0) + 1;
                return acc;
            }, {});
            const telegramStatus = {
                configured: Boolean(AIRIFICA_TELEGRAM_BOT_USERNAME && AIRIFICA_TELEGRAM_INTERNAL_SECRET),
                botUsername: AIRIFICA_TELEGRAM_BOT_USERNAME || null,
                linkedChats: telegramLinks.length,
                linkedWallets: new Set(telegramLinks.map(link => link.walletAddress)).size,
                alertsEnabledChats: telegramLinks.filter(link => link.alertsEnabled).length,
                conversationEnabledChats: telegramLinks.filter(link => link.conversationalEnabled).length,
                pendingLinkCodes: this.stateStore.countPendingTelegramLinkCodes(),
                deliveredAlerts: notifications.filter(notification => notification.status === "DELIVERED").length,
                failedAlerts: notifications.filter(notification => notification.status === "FAILED").length,
                pendingAlerts: notifications.filter(notification => notification.status === "PENDING").length,
                heartbeat: telegramHeartbeat
                    ? {
                        live: Date.now() - telegramHeartbeat.lastSeenAt <= AIRIFICA_TELEGRAM_HEARTBEAT_STALE_MS,
                        lastSeenAt: telegramHeartbeat.lastSeenAt,
                        meta: telegramHeartbeat.meta,
                    }
                    : {
                        live: false,
                        lastSeenAt: null,
                        meta: {},
                    },
            };

            const pacificaVolumeUsd = this.stateStore.listCounters("trade_volume_usd")
                .filter(counter => counter.key === "trade_volume_usd:pacifica")
                .reduce((sum, counter) => sum + Number(counter.count || 0), 0);
            const jupiterVolumeUsd = this.stateStore.listCounters("trade_volume_usd")
                .filter(counter => counter.key !== "trade_volume_usd:pacifica")
                .reduce((sum, counter) => sum + Number(counter.count || 0), 0);

            const recentTrades = executedProposals
                .slice(0, 10)
                .map((proposal) => ({
                    id: proposal.id,
                    walletAddress: proposal.walletAddress,
                    symbol: proposal.proposal.symbol,
                    side: proposal.proposal.side,
                    venue: proposal.executionVenue || "pacifica",
                    source: proposal.executionSource || "web",
                    orderId: proposal.orderId,
                    notionalUsd: proposal.executedNotionalUsd || 0,
                    marginUsd: proposal.executedMarginUsd || 0,
                    leverage: proposal.executedLeverage || 1,
                    updatedAt: proposal.updatedAt,
                }));

            const recentUsers = users.slice(0, 12).map((user) => {
                const binding = this.stateStore.getBinding(user.walletAddress);
                const linkedChats = this.stateStore.listTelegramLinksForWallet(user.walletAddress).length;
                const latestTrade = this.stateStore.getLatestExecutedProposalForWallet(user.walletAddress);

                return {
                    walletAddress: user.walletAddress,
                    firstSeenAt: user.firstSeenAt,
                    lastSeenAt: user.lastSeenAt,
                    verifiedAt: user.verifiedAt,
                    authCount: user.authCount,
                    isAdmin: user.isAdmin,
                    lastSource: user.lastSource,
                    linkedChats,
                    binding: binding
                        ? {
                            isActive: binding.isActive,
                            builderApprovedAt: binding.builderApprovedAt,
                            agentBoundAt: binding.agentBoundAt,
                            pacificaAccount: binding.pacificaAccount,
                        }
                        : null,
                    latestTrade: latestTrade
                        ? {
                            symbol: latestTrade.proposal.symbol,
                            side: latestTrade.proposal.side,
                            updatedAt: latestTrade.updatedAt,
                        }
                        : null,
                };
            });

            return {
                ok: true,
                generatedAt: Date.now(),
                overview: {
                    totalKnownWallets: users.length,
                    verifiedWallets: users.filter(user => Boolean(user.verifiedAt)).length,
                    adminWalletsSeen: users.filter(user => user.isAdmin).length,
                    adminWalletsConfigured: AIRIFICA_ADMIN_WALLETS.size,
                    pacificaBindings: bindings.length,
                    pacificaBuildersApproved: bindings.filter(binding => Boolean(binding.builderApprovedAt)).length,
                    pacificaActiveAgents: bindings.filter(binding => Boolean(binding.isActive && binding.builderApprovedAt && binding.agentBoundAt)).length,
                    totalProposals: proposals.length,
                    executedTrades: executedProposals.length,
                    pacificaExecutedVolumeUsd: pacificaVolumeUsd,
                    externalReportedVolumeUsd: jupiterVolumeUsd,
                    marketUniverseCount,
                },
                users: {
                    recent: recentUsers,
                },
                trading: {
                    proposalStatusCounts,
                    recentTrades,
                    topRequestedTickers: topCounters("requested_ticker"),
                    topRequestedContracts: topCounters("requested_contract"),
                    topTradeSymbols: topCounters("trade_symbol"),
                },
                telegram: {
                    ...telegramStatus,
                    topCommands: topCounters("telegram_command"),
                    topActions: topCounters("telegram_action"),
                },
                runtime: {
                    service: "client-airifica",
                    nodeEnv: NODE_ENV,
                    port: this.port,
                    pid: process.pid,
                    uptimeSec: Math.round(process.uptime()),
                    memory: {
                        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
                        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                        heapTotalMb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
                    },
                    config: {
                        publicAppUrl: AIRIFICA_PUBLIC_APP_URL || null,
                        corsOriginsConfigured: configuredCorsOrigins.size,
                        pacificaApiBase: PACIFICA_API_BASE,
                        pacificaPublicApiBase: PACIFICA_PUBLIC_API_BASE,
                        pacificaBuilderCode: PACIFICA_BUILDER_CODE || null,
                        pacificaBuilderMaxFeeRate: PACIFICA_BUILDER_MAX_FEE_RATE || null,
                        encryptionKeyConfigured: Boolean(AIRIFICA_ENCRYPTION_KEY),
                        authSecretConfigured: Boolean(envValue("AUTH_SECRET").trim()),
                        telegramBotUsername: AIRIFICA_TELEGRAM_BOT_USERNAME || null,
                        telegramInternalConfigured: Boolean(AIRIFICA_TELEGRAM_INTERNAL_SECRET),
                        telegramNotifyBaseUrl: AIRIFICA_TELEGRAM_NOTIFY_BASE_URL,
                        adminWallets: Array.from(AIRIFICA_ADMIN_WALLETS).map(shortWallet),
                    },
                },
            };
        };

        const extractMarketQueryFromText = (text: string, fallbackSymbol?: string | null) => {
            const raw = String(text || "").trim();
            const addressMatch = raw.match(/\b(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{25,60})\b/);
            if (addressMatch?.[1]) {
                const normalized = normalizeMarketContextQuery(addressMatch[1]);
                if (normalized)
                    return normalized;
            }

            const dollarMatch = raw.match(/\$([a-zA-Z0-9]{2,12})\b/);
            if (dollarMatch?.[1]) {
                const normalized = normalizeMarketContextQuery(dollarMatch[1]);
                if (normalized)
                    return normalized;
            }

            if (fallbackSymbol) {
                const normalized = normalizeMarketContextQuery(fallbackSymbol);
                if (normalized)
                    return normalized;
            }

            return "BTC";
        };

        const executeStoredProposal = async (
            walletAddress: string,
            proposalId: number,
            requestedMarginUsd: number,
            requestedLeverage: number,
            executionSource: "web" | "telegram" = "web",
        ) => {
            const proposal = this.stateStore.getProposal(proposalId);
            if (!proposal)
                throw new Error("proposal not found");
            if (proposal.walletAddress !== walletAddress)
                throw new Error("forbidden: wallet mismatch");
            if (!["PROPOSED", "REJECTED", "FAILED"].includes(proposal.status))
                throw new Error(`proposal already in status: ${proposal.status}`);

            const binding = this.stateStore.getBinding(walletAddress);
            if (!binding || !binding.isActive || !binding.builderApprovedAt || !binding.agentBoundAt) {
                const error: any = new Error("Pacifica onboarding incomplete");
                error.statusCode = 402;
                error.payload = {
                    ok: false,
                    needsOnboarding: true,
                    hint: "Pacifica onboarding incomplete. Connect wallet, approve AIRewardrop builder, bind the agent wallet, then fund the Pacifica account.",
                    error: "Pacifica onboarding incomplete",
                };
                throw error;
            }

            const { ctx } = await requirePacificaExecutionContext(walletAddress);
            const approvalState = await fetchBuilderApprovalState(ctx);
            if (!approvalState.hasApproval || !approvalState.hasSufficientFeeCap) {
                const error: any = new Error("Pacifica builder approval not ready for execution");
                error.statusCode = 409;
                error.payload = {
                    ok: false,
                    needsOnboarding: true,
                    hint: approvalState.hint,
                    error: "Pacifica builder approval not ready for execution",
                };
                throw error;
            }

            this.stateStore.updateProposal(proposalId, { status: "APPROVED" });

            const pacificaSide: "bid" | "ask" = proposal.proposal.side === "LONG" ? "bid" : "ask";
            const leverage = Number.isFinite(requestedLeverage) && requestedLeverage > 0 ? requestedLeverage : 1;
            const marginUsd = Number.isFinite(requestedMarginUsd) && requestedMarginUsd > 0 ? requestedMarginUsd : AIRIFICA_DEFAULT_NOTIONAL_USD;
            const requestedNotional = marginUsd * leverage;
            const size = proposal.proposal.entry > 0 ? requestedNotional / proposal.proposal.entry : 0;
            if (!Number.isFinite(size) || size <= 0) {
                this.stateStore.updateProposal(proposalId, { status: "FAILED", errorMessage: "invalid size from entry price" });
                const error: any = new Error("invalid size from entry price");
                error.statusCode = 400;
                error.payload = { ok: false, error: "invalid size from entry price" };
                throw error;
            }

            const takeProfit = proposal.proposal.tp
                ? {
                    stop_price: String(Number(proposal.proposal.tp)),
                    limit_price: String(Number(proposal.proposal.tp)),
                }
                : undefined;
            const stopLoss = proposal.proposal.sl
                ? {
                    stop_price: String(Number(proposal.proposal.sl)),
                    limit_price: String(Number(proposal.proposal.sl)),
                }
                : undefined;

            try {
                const orderResult = await createMarketOrderForContext(ctx, {
                    symbol: proposal.proposal.symbol,
                    side: pacificaSide,
                    size,
                    requestedNotionalUsd: requestedNotional,
                    reduce_only: false,
                    ...(takeProfit ? { take_profit: takeProfit } : {}),
                    ...(stopLoss ? { stop_loss: stopLoss } : {}),
                });
                const orderId = extractPacificaOrderId(orderResult);
                this.stateStore.updateProposal(proposalId, {
                    status: "EXECUTED",
                    orderId,
                    errorMessage: null,
                    executedMarginUsd: marginUsd,
                    executedLeverage: leverage,
                    executedNotionalUsd: requestedNotional,
                    executedAt: Date.now(),
                    executionSource,
                });
                this.stateStore.appendTradeLedgerRecord({
                    walletAddress,
                    venue: "pacifica",
                    marketType: "perp",
                    symbol: proposal.proposal.symbol,
                    side: proposal.proposal.side,
                    quantity: size,
                    notionalUsd: requestedNotional,
                    marginUsd,
                    leverage,
                    realizedPnlUsd: null,
                    mintAddress: null,
                    orderId,
                    txSignature: null,
                    proposalId,
                    executionSource,
                    note: "Pacifica open",
                });
                trackTradeExecutionCounters({
                    venue: "pacifica",
                    symbol: proposal.proposal.symbol,
                    notionalUsd: requestedNotional,
                    source: executionSource,
                });
                queueTelegramTradeAlert(
                    walletAddress,
                    `Opened ${proposal.proposal.side} ${proposal.proposal.symbol} from Airifica${orderId ? ` (${orderId})` : ""}.`,
                    "TRADE_OPENED",
                );

                return {
                    ok: true,
                    orderId,
                    pacificaResponse: orderResult,
                    proposal,
                    leverage,
                    marginUsd,
                };
            } catch (err: any) {
                const message = err?.message || "server error";
                if (isPacificaBetaAccessError(message)) {
                    this.stateStore.updateProposal(proposalId, {
                        status: "FAILED",
                        errorMessage: "Pacifica beta access required",
                    });
                    const error: any = new Error("Pacifica beta access required");
                    error.statusCode = 403;
                    error.payload = {
                        ok: false,
                        error: "Pacifica beta access required",
                        hint: buildPacificaBetaAccessHint(),
                        redeemUrl: PACIFICA_BETA_ACCESS_URL,
                        requiresBetaAccess: true,
                    };
                    throw error;
                }
                if (/builder approval/i.test(message) || /max_fee_rate/i.test(message)) {
                    const error: any = new Error("Pacifica builder approval not ready for execution");
                    error.statusCode = 409;
                    error.payload = {
                        ok: false,
                        needsOnboarding: true,
                        hint: message,
                        error: "Pacifica builder approval not ready for execution",
                    };
                    throw error;
                }
                if (/requires at least .* USD notional/i.test(message) || /too small for lot/i.test(message)) {
                    const error: any = new Error(message);
                    error.statusCode = 400;
                    error.payload = { ok: false, error: message, hint: message };
                    throw error;
                }

                this.stateStore.updateProposal(proposalId, {
                    status: "FAILED",
                    errorMessage: message,
                });
                throw err;
            }
        };

        /** POST /api/airi3/session */
        this.app.post("/api/airi3/session", async (req: Request, res: Response) => {
            try {
                const body = req.body as AirificaSessionRequest;
                if (!body.walletAddress) {
                    res.status(400).json({ ok: false, error: "walletAddress required" });
                    return;
                }
                if (!isValidSessionIdentity(body.walletAddress)) {
                    res.status(400).json({ ok: false, error: "invalid walletAddress or session identity" });
                    return;
                }
                this.stateStore.touchUser(body.walletAddress, { source: "session" });
                const conversationId = body.conversationId ||
                    `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const userId = this.messageManager.getUserId(body.walletAddress);
                const roomId = this.messageManager.getRoomId(body.walletAddress, conversationId);
                const response: AirificaSessionResponse = {
                    ok: true,
                    conversationId,
                    userId,
                    roomId,
                };
                res.json(response);
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /session error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        /** POST /api/airi3/message */
        this.app.post("/api/airi3/message", async (req: Request, res: Response) => {
            try {
                const body = req.body as AirificaIncomingMessage;
                if (!body.walletAddress || !body.conversationId || !body.text) {
                    res.status(400).json({ ok: false, error: "walletAddress, conversationId, text required" });
                    return;
                }
                if (!isValidSessionIdentity(body.walletAddress)) {
                    res.status(400).json({ ok: false, error: "invalid walletAddress or session identity" });
                    return;
                }
                const auth = maybeAuth(req);
                trackPromptAnalytics(body.walletAddress, auth && auth.address === body.walletAddress ? "web_authed" : "web_guest", body.text);
                const pacificaKnowledge = auth && auth.address === body.walletAddress
                    ? getPacificaKnowledgeSnapshot(auth.address)
                    : null;
                const responses = await this.messageManager.handleMessage(body, {
                    pacificaKnowledge,
                });
                // Also push to any connected WS for this session
                const wsKey = `${body.walletAddress}:${body.conversationId}`;
                const wsClient = this.wsClients.get(wsKey);
                if (wsClient && wsClient.ws.readyState === WebSocket.OPEN) {
                    for (const r of responses) {
                        wsClient.ws.send(JSON.stringify(r));
                    }
                }
                res.json({ ok: true, responses });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /message error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/proposal", async (req: Request, res: Response) => {
            try {
                const body = (req.body ?? {}) as AirificaProposalRequest;
                if (!body?.message || typeof body.message !== "object") {
                    res.status(400).json({ ok: false, error: "message required" });
                    return;
                }

                const proposal = await this.messageManager.deriveProposalFromContent({
                    text: body.message.text,
                    action: body.message.action,
                    source: "airifica",
                    ...(body.message.image ? { image: body.message.image } : {}),
                    ...(body.message.proposal ? { proposal: body.message.proposal } : {}),
                } as any);

                res.json({
                    ok: true,
                    proposal: proposal ?? null,
                });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /proposal error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        /** GET /api/airi3/history?walletAddress=...&conversationId=...&count=20 */
        this.app.get("/api/airi3/history", async (req: Request, res: Response) => {
            try {
                const { walletAddress, conversationId, count } = req.query as Record<string, string>;
                if (!walletAddress || !conversationId) {
                    res.status(400).json({ ok: false, error: "walletAddress and conversationId required" });
                    return;
                }
                if (!isValidSessionIdentity(walletAddress)) {
                    res.status(400).json({ ok: false, error: "invalid walletAddress or session identity" });
                    return;
                }
                const history = await this.messageManager.getHistory(
                    walletAddress,
                    conversationId,
                    count ? parseInt(count, 10) : 20
                );
                res.json({ ok: true, history });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /history error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        /** Health check */
        this.app.get("/api/airi3/health", (_req, res) => {
            res.json({
                ok: true,
                service: "client-airifica",
                pacificaApiBase: PACIFICA_API_BASE,
                pacificaPublicApiBase: PACIFICA_PUBLIC_API_BASE,
            });
        });

        this.app.get("/api/airi3/admin/overview", async (req: Request, res: Response) => {
            const auth = requireAdmin(req, res);
            if (!auth)
                return;

            try {
                this.stateStore.touchUser(auth.address, {
                    source: "admin_dashboard",
                    isAdmin: true,
                });
                res.json(await buildAdminOverview());
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/admin/overview error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/link/request", async (req: Request, res: Response) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return;

            try {
                this.stateStore.touchUser(auth.address, {
                    source: "telegram_link_request",
                    isAdmin: auth.isAdmin,
                });
                const linkCode = this.stateStore.createTelegramLinkCode(auth.address, AIRIFICA_TELEGRAM_LINK_CODE_TTL_MS);
                res.json({
                    ok: true,
                    code: linkCode.code,
                    expiresAt: linkCode.expiresAt,
                    deepLinkUrl: buildTelegramDeepLink(linkCode.code),
                    linkedChats: this.stateStore.listTelegramLinksForWallet(auth.address),
                });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/link/request error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.get("/api/airi3/telegram/link/status", async (req: Request, res: Response) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return;

            try {
                this.stateStore.touchUser(auth.address, {
                    source: "telegram_link_status",
                    isAdmin: auth.isAdmin,
                });
                res.json({
                    ok: true,
                    botUsername: AIRIFICA_TELEGRAM_BOT_USERNAME || null,
                    linkedChats: this.stateStore.listTelegramLinksForWallet(auth.address),
                });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/link/status error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/link/preferences", async (req: Request, res: Response) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return;

            try {
                const chatId = String(req.body?.chatId || "").trim();
                if (!chatId) {
                    res.status(400).json({ ok: false, error: "chatId required" });
                    return;
                }

                const link = this.stateStore.getTelegramLink(chatId);
                if (!link || link.walletAddress !== auth.address) {
                    res.status(404).json({ ok: false, error: "Telegram link not found" });
                    return;
                }

                const updated = this.stateStore.updateTelegramLink(chatId, {
                    ...(typeof req.body?.alertsEnabled === "boolean" ? { alertsEnabled: req.body.alertsEnabled } : {}),
                    ...(typeof req.body?.conversationalEnabled === "boolean" ? { conversationalEnabled: req.body.conversationalEnabled } : {}),
                });

                if (!updated) {
                    res.status(404).json({ ok: false, error: "Telegram link not found" });
                    return;
                }

                res.json({ ok: true, link: updated });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/link/preferences error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/link/unlink", async (req: Request, res: Response) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return;

            try {
                const chatId = String(req.body?.chatId || "").trim();
                if (!chatId) {
                    res.status(400).json({ ok: false, error: "chatId required" });
                    return;
                }

                const link = this.stateStore.getTelegramLink(chatId);
                if (!link || link.walletAddress !== auth.address) {
                    res.status(404).json({ ok: false, error: "Telegram link not found" });
                    return;
                }

                this.stateStore.deleteTelegramLink(chatId);
                res.json({ ok: true });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/link/unlink error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/notify/trade", async (req: Request, res: Response) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return;

            try {
                const symbol = normalizeSymbol(req.body?.symbol || "");
                if (!symbol) {
                    res.status(400).json({ ok: false, error: "symbol required" });
                    return;
                }

                const proposalId = Number(req.body?.proposalId);
                const amountUsd = Number(req.body?.amountUsd);
                const quantity = Number(req.body?.quantity);
                const venue = String(req.body?.venue || "frontend").trim() || "frontend";
                const txSignature = req.body?.txSignature ? String(req.body.txSignature) : null;
                const explorerUrl = req.body?.explorerUrl ? String(req.body.explorerUrl) : null;
                const outputMint = String(req.body?.outputMint || "").trim();
                const marketQuery = normalizeMarketContextQuery(req.body?.marketQuery || outputMint || symbol) || symbol;

                if (Number.isFinite(proposalId) && proposalId > 0) {
                    const storedProposal = this.stateStore.getProposal(proposalId);
                    if (storedProposal && storedProposal.walletAddress === auth.address) {
                        this.stateStore.updateProposal(proposalId, {
                            status: "EXECUTED",
                            orderId: txSignature,
                            errorMessage: null,
                            executedMarginUsd: Number.isFinite(amountUsd) ? amountUsd : null,
                            executedLeverage: 1,
                            executedNotionalUsd: Number.isFinite(amountUsd) ? amountUsd : null,
                            executedAt: Date.now(),
                            executionSource: "web",
                        });
                    }
                }
                const existingSpotWatch = outputMint
                    ? this.stateStore.getOnchainSpotWatch(auth.address, outputMint)
                    : null;
                const nextSpotQuantity = Number.isFinite(quantity) && quantity > 0
                    ? Math.max(0, Number(existingSpotWatch?.lastQuantity || 0) + quantity)
                    : Number(existingSpotWatch?.lastQuantity || 0);
                const nextSpotCostBasisUsd = Number.isFinite(amountUsd) && amountUsd > 0
                    ? Math.max(0, Number(existingSpotWatch?.costBasisUsd || 0) + amountUsd)
                    : Number(existingSpotWatch?.costBasisUsd || 0);
                this.stateStore.appendTradeLedgerRecord({
                    walletAddress: auth.address,
                    venue: "jupiter",
                    marketType: "spot",
                    symbol,
                    side: String(req.body?.side || "").trim().toUpperCase() === "SELL" ? "SELL" : "BUY",
                    quantity: Number.isFinite(quantity) ? quantity : null,
                    notionalUsd: Number.isFinite(amountUsd) ? amountUsd : null,
                    marginUsd: null,
                    leverage: 1,
                    realizedPnlUsd: null,
                    mintAddress: outputMint || null,
                    orderId: null,
                    txSignature,
                    proposalId: Number.isFinite(proposalId) && proposalId > 0 ? proposalId : null,
                    executionSource: "web",
                    note: "Jupiter spot execution",
                });

                const text = buildTelegramTradeAlertText({
                    venue,
                    symbol,
                    side: req.body?.side ? String(req.body.side) : null,
                    amountUsd: Number.isFinite(amountUsd) ? amountUsd : null,
                    quantity: Number.isFinite(quantity) ? quantity : null,
                    txSignature,
                    explorerUrl,
                });

                const notifications = this.stateStore.createTelegramNotifications(auth.address, "TRADE_OPENED", text, {
                    proposalId: Number.isFinite(proposalId) && proposalId > 0 ? proposalId : null,
                    symbol,
                    venue,
                    txSignature,
                    explorerUrl,
                    outputMint: outputMint || null,
                    marketQuery,
                });
                if (outputMint && venue.toLowerCase().includes("jupiter")) {
                    this.stateStore.upsertOnchainSpotWatch(auth.address, outputMint, {
                        symbol,
                        marketQuery,
                        lastTradeAt: Date.now(),
                        lastTxSignature: txSignature,
                        lastNotionalUsd: Number.isFinite(amountUsd) ? amountUsd : null,
                        lastQuantity: Number.isFinite(nextSpotQuantity) ? nextSpotQuantity : null,
                        costBasisUsd: Number.isFinite(nextSpotCostBasisUsd) ? nextSpotCostBasisUsd : null,
                        realizedPnlUsd: Number(existingSpotWatch?.realizedPnlUsd || 0),
                    });
                }
                this.stateStore.touchUser(auth.address, { source: "telegram_notify" });
                trackTradeExecutionCounters({
                    venue,
                    symbol,
                    notionalUsd: Number.isFinite(amountUsd) ? amountUsd : 0,
                    source: "web",
                });
                res.json({
                    ok: true,
                    queued: notifications.length,
                });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/notify/trade error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/link/consume", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const code = String(req.body?.code || "").trim();
                const chatId = String(req.body?.chatId || "").trim();
                const userId = String(req.body?.userId || "").trim();
                const username = req.body?.username ? String(req.body.username) : null;
                const firstName = req.body?.firstName ? String(req.body.firstName) : null;

                if (!code || !chatId || !userId) {
                    res.status(400).json({ ok: false, error: "code, chatId, userId required" });
                    return;
                }

                const link = this.stateStore.consumeTelegramLinkCode(code, {
                    chatId,
                    userId,
                    username,
                    firstName,
                });
                if (!link) {
                    res.status(404).json({ ok: false, error: "Invalid or expired link code" });
                    return;
                }

                this.stateStore.touchUser(link.walletAddress, { source: "telegram_link" });
                this.stateStore.incrementCounter("telegram_link", "linked");
                void maybePrimePacificaKnowledge(link.walletAddress);
                res.json({
                    ok: true,
                    link: {
                        walletAddress: link.walletAddress,
                        alertsEnabled: link.alertsEnabled,
                        conversationalEnabled: link.conversationalEnabled,
                    },
                });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/link/consume error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/unlink", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const chatId = String(req.body?.chatId || "").trim();
                if (!chatId) {
                    res.status(400).json({ ok: false, error: "chatId required" });
                    return;
                }

                res.json({ ok: this.stateStore.deleteTelegramLink(chatId) });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/unlink error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/link/status", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const chatId = String(req.body?.chatId || "").trim();
                if (!chatId) {
                    res.status(400).json({ ok: false, error: "chatId required" });
                    return;
                }
                const link = this.stateStore.getTelegramLink(chatId);
                const summary = link ? await buildTelegramWalletSummary(link.walletAddress) : null;
                res.json({ ok: true, link, summary });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/link/status error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/runtime/heartbeat", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const meta = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
                this.stateStore.updateRuntimeHeartbeat("telegram", meta);
                res.json({ ok: true });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/runtime/heartbeat error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/analytics/event", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const chatId = String(req.body?.chatId || "").trim();
                const category = String(req.body?.category || "").trim().toLowerCase();
                const key = String(req.body?.key || "").trim();
                if (!category || !key) {
                    res.status(400).json({ ok: false, error: "category and key required" });
                    return;
                }

                if (!["telegram_command", "telegram_action", "telegram_action_prompt"].includes(category)) {
                    res.status(400).json({ ok: false, error: "unsupported analytics category" });
                    return;
                }

                if (chatId) {
                    const link = this.stateStore.getTelegramLink(chatId);
                    if (link)
                        this.stateStore.touchUser(link.walletAddress, { source: "telegram_event" });
                }

                this.stateStore.incrementCounter(category, key);
                res.json({ ok: true });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/analytics/event error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/alerts/toggle", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const chatId = String(req.body?.chatId || "").trim();
                const enabled = Boolean(req.body?.enabled);
                if (!chatId) {
                    res.status(400).json({ ok: false, error: "chatId required" });
                    return;
                }

                const updated = this.stateStore.updateTelegramLink(chatId, { alertsEnabled: enabled });
                if (!updated) {
                    res.status(404).json({ ok: false, error: "Telegram link not found" });
                    return;
                }

                res.json({ ok: true, alertsEnabled: updated.alertsEnabled });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/alerts/toggle error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/chat/toggle", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const chatId = String(req.body?.chatId || "").trim();
                const enabled = Boolean(req.body?.enabled);
                if (!chatId) {
                    res.status(400).json({ ok: false, error: "chatId required" });
                    return;
                }

                const updated = this.stateStore.updateTelegramLink(chatId, { conversationalEnabled: enabled });
                if (!updated) {
                    res.status(404).json({ ok: false, error: "Telegram link not found" });
                    return;
                }

                res.json({ ok: true, conversationalEnabled: updated.conversationalEnabled });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/chat/toggle error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.get("/api/airi3/telegram/internal/alerts/pending", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const limit = Number(req.query.limit || 20);
                res.json({
                    ok: true,
                    alerts: this.stateStore.listPendingTelegramNotifications(Number.isFinite(limit) ? limit : 20),
                });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/alerts/pending error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/alerts/:id/delivered", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const id = Number(req.params.id);
                if (!Number.isFinite(id)) {
                    res.status(400).json({ ok: false, error: "invalid id" });
                    return;
                }
                this.stateStore.markTelegramNotificationDelivered(id);
                res.json({ ok: true });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/alerts/:id/delivered error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/alerts/:id/failed", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const id = Number(req.params.id);
                if (!Number.isFinite(id)) {
                    res.status(400).json({ ok: false, error: "invalid id" });
                    return;
                }
                this.stateStore.markTelegramNotificationFailed(id, String(req.body?.error || "delivery failed"));
                res.json({ ok: true });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/alerts/:id/failed error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/positions", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const chatId = String(req.body?.chatId || "").trim();
                const link = this.stateStore.getTelegramLink(chatId);
                if (!link) {
                    res.status(404).json({ ok: false, error: "Telegram chat is not linked to any wallet" });
                    return;
                }

                const overview = await buildPacificaOverview(link.walletAddress);
                await maybePrimePacificaKnowledge(link.walletAddress, overview);
                res.json({
                    ok: true,
                    walletAddress: link.walletAddress,
                    overview,
                });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/positions error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/history", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const chatId = String(req.body?.chatId || "").trim();
                const link = this.stateStore.getTelegramLink(chatId);
                if (!link) {
                    res.status(404).json({ ok: false, error: "Telegram chat is not linked to any wallet" });
                    return;
                }

                const overview = await buildPacificaOverview(link.walletAddress);
                await maybePrimePacificaKnowledge(link.walletAddress, overview);
                const history = await buildTelegramTradeHistory(link.walletAddress, overview);
                const summary = await buildTelegramWalletSummary(link.walletAddress, overview);
                res.json({
                    ok: true,
                    walletAddress: link.walletAddress,
                    summary,
                    history,
                });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/history error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/close", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const chatId = String(req.body?.chatId || "").trim();
                const link = this.stateStore.getTelegramLink(chatId);
                if (!link) {
                    res.status(404).json({ ok: false, error: "Telegram chat is not linked to any wallet" });
                    return;
                }

                const result = await closePacificaPositionForWallet(link.walletAddress, {
                    symbol: String(req.body?.symbol || ""),
                    side: req.body?.side ? normalizePacificaSide(req.body.side, null) : null,
                    amount: req.body?.amount != null ? Number(req.body.amount) : null,
                }, "telegram");
                queueTelegramTradeAlert(
                    link.walletAddress,
                    `Closed ${result.side} ${result.symbol} position (${result.amount}).`,
                    "POSITION_CLOSED",
                );
                res.json({ ok: true, closed: result });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/close error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/message", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const chatId = String(req.body?.chatId || "").trim();
                const text = String(req.body?.text || "").trim();
                if (!chatId || !text) {
                    res.status(400).json({ ok: false, error: "chatId and text required" });
                    return;
                }

                const link = this.stateStore.getTelegramLink(chatId);
                if (!link) {
                    res.status(404).json({ ok: false, error: "Telegram chat is not linked to any wallet" });
                    return;
                }
                if (!link.conversationalEnabled) {
                    res.status(403).json({ ok: false, error: "Telegram conversation is disabled for this chat" });
                    return;
                }

                trackPromptAnalytics(link.walletAddress, "telegram", text);
                const pacificaKnowledge = getPacificaKnowledgeSnapshot(link.walletAddress);
                const responses = await this.messageManager.handleMessage({
                    walletAddress: link.walletAddress,
                    conversationId: `tg_${chatId}`,
                    text,
                }, {
                    pacificaKnowledge,
                });

                res.json({ ok: true, responses });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/message error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/proposals/prepare", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const chatId = String(req.body?.chatId || "").trim();
                const link = this.stateStore.getTelegramLink(chatId);
                if (!link) {
                    res.status(404).json({ ok: false, error: "Telegram chat is not linked to any wallet" });
                    return;
                }

                const rawProposal = req.body?.proposal || {};
                const symbol = String(rawProposal.symbol || "").trim().toUpperCase();
                const side = String(rawProposal.side || "").trim().toUpperCase() === "SHORT" ? "SHORT" : "LONG";
                const entry = Number(rawProposal.entry);
                const tp = Number(rawProposal.tp);
                const sl = Number(rawProposal.sl);
                if (!symbol || !Number.isFinite(entry) || !Number.isFinite(tp) || !Number.isFinite(sl)) {
                    res.status(400).json({ ok: false, error: "invalid proposal payload" });
                    return;
                }

                const sourceText = String(req.body?.sourceText || "").trim();
                const marketQuery = extractMarketQueryFromText(sourceText, symbol);
                const market = await fetchMarketContext(marketQuery, "1h", 96);
                const summary = await buildTelegramWalletSummary(link.walletAddress);

                if (market.executionVenue === "pacifica" && market.supportedOnPacifica) {
                    const proposal = this.stateStore.createProposal(link.walletAddress, `tg_${chatId}`, {
                        symbol,
                        side,
                        entry,
                        tp,
                        sl,
                        timeframe: String(rawProposal.timeframe || "1H"),
                        confidence: Number.isFinite(Number(rawProposal.confidence)) ? Number(rawProposal.confidence) : 0.6,
                        thesis: String(rawProposal.thesis || "").slice(0, 500),
                        sourceAction: String(rawProposal.sourceAction || "AIRIFICA_TELEGRAM"),
                    }, {
                        marketQuery,
                        executionVenue: market.executionVenue,
                        supportedOnPacifica: market.supportedOnPacifica,
                        supportedOnJupiter: market.supportedOnJupiter,
                        baseTokenAddress: market.baseTokenAddress,
                        pairAddress: market.pairAddress,
                        maxLeverage: market.maxLeverage,
                    });

                    res.json({
                        ok: true,
                        kind: "pacifica",
                        proposalId: proposal.id,
                        availableUsd: summary.availableUsd,
                        maxLeverage: market.maxLeverage || 1,
                        proposal: proposal.proposal,
                        market: {
                            symbol: market.symbol,
                            executionVenue: market.executionVenue,
                            minOrderSize: market.minOrderSize,
                            lotSize: market.lotSize,
                        },
                    });
                    return;
                }

                if (market.executionVenue === "jupiter" && market.supportedOnJupiter) {
                    const proposal = this.stateStore.createProposal(link.walletAddress, `tg_${chatId}`, {
                        symbol,
                        side,
                        entry,
                        tp,
                        sl,
                        timeframe: String(rawProposal.timeframe || "1H"),
                        confidence: Number.isFinite(Number(rawProposal.confidence)) ? Number(rawProposal.confidence) : 0.6,
                        thesis: String(rawProposal.thesis || "").slice(0, 500),
                        sourceAction: String(rawProposal.sourceAction || "AIRIFICA_TELEGRAM"),
                    }, {
                        marketQuery,
                        executionVenue: market.executionVenue,
                        supportedOnPacifica: market.supportedOnPacifica,
                        supportedOnJupiter: market.supportedOnJupiter,
                        baseTokenAddress: market.baseTokenAddress,
                        pairAddress: market.pairAddress,
                        maxLeverage: 1,
                    });

                    res.json({
                        ok: true,
                        kind: "spot",
                        proposalId: proposal.id,
                        availableUsd: summary.availableUsd,
                        proposal: proposal.proposal,
                        market: {
                            symbol: market.symbol,
                            executionVenue: market.executionVenue,
                            supportedOnPacifica: market.supportedOnPacifica,
                            supportedOnJupiter: market.supportedOnJupiter,
                            baseTokenAddress: market.baseTokenAddress,
                            requestQuery: market.requestQuery || marketQuery,
                        },
                    });
                    return;
                }

                res.json({
                    ok: true,
                    kind: market.supportedOnJupiter ? "jupiter" : "external",
                    proposal: {
                        symbol,
                        side,
                        entry,
                        tp,
                        sl,
                        timeframe: String(rawProposal.timeframe || "1H"),
                        confidence: Number.isFinite(Number(rawProposal.confidence)) ? Number(rawProposal.confidence) : 0.6,
                    },
                    market: {
                        symbol: market.symbol,
                        executionVenue: market.executionVenue,
                        supportedOnPacifica: market.supportedOnPacifica,
                        supportedOnJupiter: market.supportedOnJupiter,
                        baseTokenAddress: market.baseTokenAddress,
                    },
                });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/proposals/prepare error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/proposals/:id", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const chatId = String(req.body?.chatId || "").trim();
                const link = this.stateStore.getTelegramLink(chatId);
                if (!link) {
                    res.status(404).json({ ok: false, error: "Telegram chat is not linked to any wallet" });
                    return;
                }

                const proposalId = Number(req.params.id);
                if (!Number.isFinite(proposalId)) {
                    res.status(400).json({ ok: false, error: "invalid proposal id" });
                    return;
                }

                const proposal = this.stateStore.getProposal(proposalId);
                if (!proposal || proposal.walletAddress !== link.walletAddress) {
                    res.status(404).json({ ok: false, error: "proposal not found" });
                    return;
                }

                const summary = await buildTelegramWalletSummary(link.walletAddress);
                res.json({
                    ok: true,
                    proposal: {
                        id: proposal.id,
                        status: proposal.status,
                        errorMessage: proposal.errorMessage,
                        data: proposal.proposal,
                        executionVenue: proposal.executionVenue || null,
                        supportedOnPacifica: proposal.supportedOnPacifica || false,
                        supportedOnJupiter: proposal.supportedOnJupiter || false,
                        baseTokenAddress: proposal.baseTokenAddress || null,
                        maxLeverage: proposal.maxLeverage || 1,
                    },
                    availableUsd: summary.availableUsd,
                });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/proposals/:id error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/telegram/internal/proposals/:id/approve", async (req: Request, res: Response) => {
            if (!requireTelegramInternal(req, res))
                return;

            try {
                const chatId = String(req.body?.chatId || "").trim();
                const link = this.stateStore.getTelegramLink(chatId);
                if (!link) {
                    res.status(404).json({ ok: false, error: "Telegram chat is not linked to any wallet" });
                    return;
                }

                const proposalId = Number(req.params.id);
                if (!Number.isFinite(proposalId)) {
                    res.status(400).json({ ok: false, error: "invalid proposal id" });
                    return;
                }

                const proposal = this.stateStore.getProposal(proposalId);
                if (!proposal || proposal.walletAddress !== link.walletAddress) {
                    res.status(404).json({ ok: false, error: "proposal not found" });
                    return;
                }
                if (proposal.executionVenue !== "pacifica" || !proposal.supportedOnPacifica) {
                    res.status(409).json({ ok: false, error: "proposal is not executable on Pacifica from Telegram" });
                    return;
                }

                const summary = await buildTelegramWalletSummary(link.walletAddress);
                const pct = Math.min(100, Math.max(1, Number(req.body?.collateral_pct || 10)));
                const requestedCollateralUsd = Number(req.body?.collateral_usd);
                const leverage = Math.min(
                    Math.max(1, Number(proposal.maxLeverage || 1)),
                    Math.max(1, Number(req.body?.leverage || 1)),
                );
                const availableUsd = Number(summary.availableUsd || 0);
                const marginUsd = Number.isFinite(requestedCollateralUsd) && requestedCollateralUsd > 0
                    ? Math.min(availableUsd, requestedCollateralUsd)
                    : Math.min(availableUsd, availableUsd * (pct / 100));
                if (!Number.isFinite(marginUsd) || marginUsd <= 0) {
                    res.status(400).json({ ok: false, error: "No available collateral to execute this trade" });
                    return;
                }

                const result = await executeStoredProposal(link.walletAddress, proposalId, marginUsd, leverage, "telegram");
                res.json({
                    ok: true,
                    orderId: result.orderId,
                    leverage,
                    marginUsd,
                    symbol: result.proposal.proposal.symbol,
                    side: result.proposal.proposal.side,
                });
            } catch (err: any) {
                if (err?.payload && err?.statusCode) {
                    res.status(err.statusCode).json(err.payload);
                    return;
                }
                elizaLogger.error("[client-airifica] /api/airi3/telegram/internal/proposals/:id/approve error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.get("/api/airi3/market-context", async (req: Request, res: Response) => {
            try {
                const rawSymbol = Array.isArray(req.query.symbol) ? req.query.symbol[0] : req.query.symbol;
                const symbol = normalizeMarketContextQuery(rawSymbol) || "BTC";
                const rawTf = Array.isArray(req.query.tf) ? req.query.tf[0] : req.query.tf;
                const timeframe = typeof rawTf === "string" ? rawTf.toLowerCase() : "1h";
                const rawLimit = Number(Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit);
                const limit = Number.isFinite(rawLimit) ? rawLimit : 96;
                if (/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{25,60})$/.test(String(rawSymbol || "").trim()))
                    this.stateStore.incrementCounter("requested_contract", String(rawSymbol).trim());
                else
                    this.stateStore.incrementCounter("requested_ticker", symbol);
                this.stateStore.incrementCounter("request_source", "market_context");

                const payload = await fetchMarketContext(symbol, timeframe, limit);
                res.json(payload);
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/market-context error:", err);
                res.status(500).json({ error: err?.message || "Failed to fetch Airifica market context" });
            }
        });

        this.app.get("/api/airi3/market-universe", async (_req: Request, res: Response) => {
            try {
                const payload = await fetchPacificaMarketUniverse();
                res.json({ ok: true, markets: payload });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/market-universe error:", err);
                res.status(500).json({ ok: false, error: err?.message || "Failed to fetch Pacifica market universe" });
            }
        });

        this.app.post("/api/airi3/proposals", async (req: Request, res: Response) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return;

            try {
                const {
                    walletAddress,
                    conversation_id,
                    symbol,
                    side,
                    entry_price,
                    tp_price,
                    sl_price,
                    timeframe,
                    confidence,
                    thesis,
                    source_client,
                } = req.body ?? {};

                if (walletAddress && walletAddress !== auth.address) {
                    res.status(403).json({ ok: false, error: "wallet mismatch" });
                    return;
                }

                if (!symbol || !side || entry_price == null || tp_price == null || sl_price == null) {
                    res.status(400).json({ ok: false, error: "symbol, side, entry_price, tp_price, sl_price required" });
                    return;
                }

                const proposal = this.stateStore.createProposal(auth.address, conversation_id || "unknown", {
                    symbol: String(symbol).toUpperCase(),
                    side: String(side).toUpperCase() === "SHORT" ? "SHORT" : "LONG",
                    entry: Number(entry_price),
                    tp: Number(tp_price),
                    sl: Number(sl_price),
                    timeframe: timeframe || "1H",
                    confidence: confidence != null ? Number(confidence) : 0.6,
                    thesis: thesis ? String(thesis).slice(0, 500) : null,
                    sourceAction: source_client || "AIRIFICA_STAGE_WEB",
                });
                this.stateStore.touchUser(auth.address, { source: "proposal_create", isAdmin: auth.isAdmin });

                res.json({ ok: true, proposal: { id: proposal.id } });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/proposals error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/proposals/:id/approve", async (req: Request, res: Response) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return;

            try {
                const proposalId = Number(req.params.id);
                if (!Number.isFinite(proposalId)) {
                    res.status(400).json({ ok: false, error: "invalid id" });
                    return;
                }
                const requestedMarginUsd = Number(req.body?.notional_usd || AIRIFICA_DEFAULT_NOTIONAL_USD);
                const requestedLeverage = Number(req.body?.leverage || 1);
                const result = await executeStoredProposal(auth.address, proposalId, requestedMarginUsd, requestedLeverage, "web");
                res.json({ ok: true, orderId: result.orderId, pacificaResponse: result.pacificaResponse });
            } catch (err: any) {
                if (err?.payload && err?.statusCode) {
                    res.status(err.statusCode).json(err.payload);
                    return;
                }
                elizaLogger.error("[client-airifica] /api/airi3/proposals/:id/approve error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/pacifica/prepare-agent", async (req: Request, res: Response) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return;

            try {
                if (!AIRIFICA_ENCRYPTION_KEY) {
                    res.status(500).json({ ok: false, error: "AIRIFICA_ENCRYPTION_KEY not configured" });
                    return;
                }
                if (!PACIFICA_BUILDER_CODE) {
                    res.status(500).json({ ok: false, error: "PACIFICA_BUILDER_CODE not configured" });
                    return;
                }

                const pacificaAccount = String(req.body?.pacificaAccount || auth.address).trim();
                if (!isValidSolanaAddress(pacificaAccount)) {
                    res.status(400).json({ ok: false, error: "pacificaAccount required" });
                    return;
                }

                const { publicKey, privateKeyPkcs8Base64 } = generateAgentWallet();
                const binding = this.stateStore.upsertBinding(auth.address, {
                    pacificaAccount,
                    agentWalletPublicKey: publicKey,
                    encryptedAgentWalletPrivateKey: encryptAgentPrivateKey(privateKeyPkcs8Base64, AIRIFICA_ENCRYPTION_KEY),
                    builderCode: PACIFICA_BUILDER_CODE,
                    isActive: false,
                    builderApprovedAt: null,
                    agentBoundAt: null,
                });

                const approveBuilder = buildApproveBuilderPayload(
                    binding.builderCode,
                    req.body?.max_fee_rate || PACIFICA_BUILDER_MAX_FEE_RATE,
                    PACIFICA_EXPIRY_MS,
                );
                const bindAgent = buildBindAgentWalletPayload(
                    binding.agentWalletPublicKey,
                    PACIFICA_EXPIRY_MS,
                );

                res.json({
                    ok: true,
                    agentWalletPublicKey: binding.agentWalletPublicKey,
                    builderCode: binding.builderCode,
                    unsignedPayloads: {
                        approveBuilder,
                        bindAgent,
                    },
                });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/pacifica/prepare-agent error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/pacifica/approve-builder", async (req: Request, res: Response) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return;

            try {
                const binding = this.stateStore.getBinding(auth.address);
                if (!binding) {
                    res.status(404).json({ ok: false, error: "No agent wallet prepared. Call /prepare-agent first." });
                    return;
                }
                const signedPayload = req.body?.signedPayload;
                if (!signedPayload) {
                    res.status(400).json({ ok: false, error: "signedPayload required" });
                    return;
                }
                const signedBuilderCode = String(signedPayload?.builder_code || "").trim();
                if (!signedBuilderCode || signedBuilderCode !== binding.builderCode) {
                    res.status(400).json({ ok: false, error: "signedPayload builder_code mismatch" });
                    return;
                }

                const pacificaResponse = await submitApproveBuilder({
                    apiBase: PACIFICA_API_BASE,
                    apiKey: PACIFICA_API_KEY,
                }, binding.pacificaAccount, signedPayload);
                const approvalState = await fetchBuilderApprovalState({
                    account: binding.pacificaAccount,
                    apiBase: PACIFICA_API_BASE,
                    apiKey: PACIFICA_API_KEY,
                    builderCode: binding.builderCode,
                });
                if (!approvalState.hasApproval || !approvalState.hasSufficientFeeCap)
                    throw new Error(approvalState.hint);
                this.stateStore.updateBinding(auth.address, {
                    builderApprovedAt: Date.now(),
                });
                res.json({ ok: true, pacificaResponse });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/pacifica/approve-builder error:", err);
                res.status(502).json({ ok: false, error: err?.message || "Pacifica builder approval failed" });
            }
        });

        this.app.post("/api/airi3/pacifica/bind-agent", async (req: Request, res: Response) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return;

            try {
                const binding = this.stateStore.getBinding(auth.address);
                if (!binding) {
                    res.status(404).json({ ok: false, error: "No agent wallet prepared." });
                    return;
                }
                const signedPayload = req.body?.signedPayload;
                if (!signedPayload) {
                    res.status(400).json({ ok: false, error: "signedPayload required" });
                    return;
                }
                const signedAgentWallet = String(signedPayload?.agent_wallet || "").trim();
                if (!signedAgentWallet || signedAgentWallet !== binding.agentWalletPublicKey) {
                    res.status(400).json({ ok: false, error: "signedPayload agent_wallet mismatch" });
                    return;
                }

                const pacificaResponse = await submitBindAgentWallet({
                    apiBase: PACIFICA_API_BASE,
                    apiKey: PACIFICA_API_KEY,
                }, binding.pacificaAccount, signedPayload);
                this.stateStore.updateBinding(auth.address, {
                    agentBoundAt: Date.now(),
                    isActive: Boolean(binding.builderApprovedAt),
                });
                res.json({ ok: true, pacificaResponse });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/pacifica/bind-agent error:", err);
                res.status(502).json({ ok: false, error: err?.message || "Pacifica agent bind failed" });
            }
        });

        this.app.get("/api/airi3/pacifica/status", async (req: Request, res: Response) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return;

            try {
                res.json({
                    ok: true,
                    status: buildBindingStatus(this.stateStore.getBinding(auth.address)),
                });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/pacifica/status error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.get("/api/airi3/pacifica/overview", async (req: Request, res: Response) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return;

            try {
                const overview = await buildPacificaOverview(auth.address);
                await maybePrimePacificaKnowledge(auth.address, overview);
                res.json(overview);
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/pacifica/overview error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        this.app.post("/api/airi3/pacifica/positions/close", async (req: Request, res: Response) => {
            const auth = requireAuth(req, res);
            if (!auth)
                return;

            try {
                const result = await closePacificaPositionForWallet(auth.address, {
                    symbol: String(req.body?.symbol || ""),
                    side: req.body?.side ? normalizePacificaSide(req.body.side, null) : null,
                    amount: req.body?.amount != null ? Number(req.body.amount) : null,
                }, "web");
                queueTelegramTradeAlert(
                    auth.address,
                    `Closed ${result.side} ${result.symbol} position from Airifica frontend (${result.amount}).`,
                    "POSITION_CLOSED",
                );
                res.json({
                    ok: true,
                    closed: {
                        symbol: result.symbol,
                        side: result.side,
                        amount: result.amount,
                    },
                    orderId: result.orderId,
                    pacificaResponse: result.pacificaResponse,
                });
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /api/airi3/pacifica/positions/close error:", err);
                res.status(500).json({ ok: false, error: err?.message || "server error" });
            }
        });

        /**
         * OpenAI-compatible chat completions — lets stage-web use this as a
         * standard provider without touching TTS / animation pipeline.
         *
         * Accepts both streaming (SSE) and non-streaming responses.
         * Wallet address comes from X-Wallet-Address header.
         */
        this.app.post("/v1/chat/completions", async (req: Request, res: Response) => {
            try {
                const sessionIdentity = String(
                    req.headers["x-session-identity"]
                    || req.headers["x-wallet-address"]
                    || ""
                ).trim();
                if (!sessionIdentity || !isValidSessionIdentity(sessionIdentity)) {
                    res.status(400).json({ error: "x-session-identity header required" });
                    return;
                }

                // Reuse or create a conversation ID per wallet
                if (!this.walletConvMap.has(sessionIdentity)) {
                    this.walletConvMap.set(
                        sessionIdentity,
                        `conv_oa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
                    );
                }
                const conversationId = this.walletConvMap.get(sessionIdentity)!;

                // Extract the last user message from the OpenAI messages array
                const messages: { role: string; content: string }[] = req.body?.messages ?? [];
                const lastUser = [...messages].reverse().find((m) => m.role === "user");
                const text = typeof lastUser?.content === "string"
                    ? lastUser.content
                    : JSON.stringify(lastUser?.content ?? "");

                if (!text.trim()) {
                    res.status(400).json({ error: "no user message found" });
                    return;
                }

                // Call eliza runtime
                const auth = maybeAuth(req);
                const pacificaKnowledge = auth && auth.address === sessionIdentity
                    ? getPacificaKnowledgeSnapshot(auth.address)
                    : null;

                const responses = await this.messageManager.handleMessage({
                    walletAddress: sessionIdentity,
                    conversationId,
                    text,
                }, {
                    pacificaKnowledge,
                });

                const replyText = responses.map((r: any) => r.message?.text ?? r.text ?? "").join(" ").trim()
                    || "…";

                const id = `chatcmpl-airifica-${Date.now()}`;
                const wantsStream = req.body?.stream === true;

                if (wantsStream) {
                    res.setHeader("Content-Type", "text/event-stream");
                    res.setHeader("Cache-Control", "no-cache");
                    res.setHeader("Connection", "keep-alive");

                    // Send role chunk
                    res.write(`data: ${JSON.stringify({
                        id, object: "chat.completion.chunk", model: req.body?.model ?? "airifica",
                        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]
                    })}

`);

                    // Stream text word-by-word for natural feel
                    const words = replyText.split(" ");
                    for (let i = 0; i < words.length; i++) {
                        const chunk = i === 0 ? words[i] : " " + words[i];
                        res.write(`data: ${JSON.stringify({
                            id, object: "chat.completion.chunk", model: req.body?.model ?? "airifica",
                            choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }]
                        })}

`);
                    }

                    // Final stop chunk
                    res.write(`data: ${JSON.stringify({
                        id, object: "chat.completion.chunk", model: req.body?.model ?? "airifica",
                        choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
                    })}

`);
                    res.write("data: [DONE]\n\n");
                    res.end();
                } else {
                    res.json({
                        id,
                        object: "chat.completion",
                        model: req.body?.model ?? "airifica",
                        choices: [{
                            index: 0,
                            message: { role: "assistant", content: replyText },
                            finish_reason: "stop",
                        }],
                        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                    });
                }
            } catch (err: any) {
                elizaLogger.error("[client-airifica] /v1/chat/completions error:", err);
                if (!res.headersSent) {
                    res.status(500).json({ error: err?.message || "server error" });
                }
            }
        });

        /** OpenAI models list — returns the single airifica model */
        this.app.get("/v1/models", (_req, res) => {
            res.json({
                object: "list",
                data: [{ id: "airifica", object: "model", created: 0, owned_by: "airifica" }],
            });
        });
    }

    private setupWs() {
        this.wss.on("connection", (ws: WebSocket, req) => {
            const url = new URL(req.url || "", `http://localhost:${this.port}`);
            const walletAddress = url.searchParams.get("walletAddress") || "";
            const conversationId = url.searchParams.get("conversationId") || "";

            if (!walletAddress || !conversationId) {
                ws.close(1008, "walletAddress and conversationId required");
                return;
            }
            if (!isValidSessionIdentity(walletAddress)) {
                ws.close(1008, "invalid walletAddress or session identity");
                return;
            }

            const wsKey = `${walletAddress}:${conversationId}`;
            const userId = this.messageManager.getUserId(walletAddress);
            const roomId = this.messageManager.getRoomId(walletAddress, conversationId);

            this.wsClients.set(wsKey, {
                walletAddress,
                conversationId,
                userId,
                roomId,
                ws,
            });

            elizaLogger.info(`[client-airifica] WS connected: ${walletAddress.slice(0, 8)}`);

            ws.on("message", async (data) => {
                try {
                    const msg = JSON.parse(data.toString()) as { text: string };
                    if (!msg.text) return;
                    const responses = await this.messageManager.handleMessage({
                        walletAddress,
                        conversationId,
                        text: msg.text,
                    });
                    for (const r of responses) {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify(r));
                        }
                    }
                } catch (err) {
                    elizaLogger.error("[client-airifica] WS message error:", err);
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ ok: false, error: "message processing failed" }));
                    }
                }
            });

            ws.on("close", () => {
                this.wsClients.delete(wsKey);
                elizaLogger.info(`[client-airifica] WS disconnected: ${walletAddress.slice(0, 8)}`);
            });

            // Send a welcome ping
            ws.send(JSON.stringify({ ok: true, conversationId, message: { text: "Airifica connected" } }));
        });
    }

    public start(): Promise<boolean> {
        return new Promise((resolve) => {
            const onError = (err: NodeJS.ErrnoException) => {
                this.httpServer.removeListener("error", onError);
                this.wss.removeListener("error", onError);
                if (err.code === "EADDRINUSE") {
                    elizaLogger.error(
                        `[client-airifica] Port ${this.port} already in use — ` +
                        `set AIRIFICA_PORT to a different value and restart.`
                    );
                } else {
                    elizaLogger.error("[client-airifica] Server error:", err);
                }
                resolve(false);
            };
            this.httpServer.on("error", onError);
            this.wss.on("error", onError);
            this.httpServer.listen(this.port, () => {
                this.httpServer.removeListener("error", onError);
                elizaLogger.success(`[client-airifica] HTTP+WS server listening on port ${this.port}`);
                elizaLogger.info(`  POST  http://localhost:${this.port}/api/airi3/session`);
                elizaLogger.info(`  POST  http://localhost:${this.port}/api/airi3/message`);
                elizaLogger.info(`  GET   http://localhost:${this.port}/api/airi3/history`);
                elizaLogger.info(`  WS    ws://localhost:${this.port}/api/airi3/ws`);
                resolve(true);
            });
        });
    }

    public stop(): void {
        this.wss.close();
        this.httpServer.close();
        elizaLogger.info("[client-airifica] Server stopped");
    }
}
