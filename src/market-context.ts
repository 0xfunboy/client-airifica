function envValue(name: string, fallback = '') {
    return process.env[`AIRIFICA_${name}`] ?? process.env[`AIRI3_${name}`] ?? fallback;
}

const PACIFICA_PUBLIC_API_BASE = (envValue('PACIFICA_PUBLIC_API_BASE', process.env.PACIFICA_PUBLIC_API_BASE || 'https://api.pacifica.fi/api/v1')).replace(/\/$/, '');
const PACIFICA_SYMBOLS_TTL_MS = Number(process.env.PACIFICA_SYMBOLS_TTL_MS || 6 * 60 * 60_000);
const SUPPORTED_INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d']);
const DEXSCREENER_API_BASE = 'https://api.dexscreener.com';
const GECKOTERMINAL_API_BASE = 'https://api.geckoterminal.com/api/v2';
const EXTERNAL_MARKET_CACHE_TTL_MS = Number(envValue('EXTERNAL_MARKET_CACHE_TTL_MS', '30000'));
const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{25,60}$/;
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

let pacificaSymbolsCache: { ts: number; symbols: Set<string> } | null = null;
let pacificaPricesCache: { ts: number; prices: Record<string, any> } | null = null;
let pacificaContractsCache: { ts: number; contracts: Record<string, any> } | null = null;
const externalMarketCache = new Map<string, { ts: number; payload: MarketContextPayload }>();

const NUMERIC_CHAIN_TO_NETWORK: Record<number, string> = {
    1: 'ethereum',
    10: 'optimism',
    56: 'bsc',
    100: 'gnosis',
    101: 'solana',
    137: 'polygon_pos',
    250: 'fantom',
    324: 'zksync',
    8453: 'base',
    42161: 'arbitrum',
    43114: 'avalanche',
};

const CHAIN_NETWORK_ALIASES: Record<string, string> = {
    arbitrum: 'arbitrum',
    avalanche: 'avalanche',
    avax: 'avalanche',
    base: 'base',
    bsc: 'bsc',
    cronos: 'cronos',
    cro: 'cronos',
    ethereum: 'ethereum',
    eth: 'ethereum',
    fantom: 'fantom',
    gnosis: 'gnosis',
    optimism: 'optimism',
    polygon: 'polygon_pos',
    'polygon-pos': 'polygon_pos',
    polygon_pos: 'polygon_pos',
    solana: 'solana',
    zksync: 'zksync',
};

export interface MarketContextCandle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface MarketContextPayload {
    symbol: string;
    tf: string;
    provider: 'pacifica' | 'geckoterminal' | 'dexscreener';
    venue: 'perp' | 'spot';
    marketSymbol: string;
    quote: string;
    price: number;
    changePct: number;
    high: number;
    low: number;
    updatedAt: number;
    data: MarketContextCandle[];
    funding?: number | null;
    openInterest?: number | null;
    supportedOnPacifica: boolean;
    supportedOnJupiter?: boolean;
    executionVenue?: 'pacifica' | 'jupiter' | null;
    chainId?: string | null;
    baseTokenAddress?: string | null;
    baseTokenName?: string | null;
    pairAddress?: string | null;
    liquidityUsd?: number | null;
    volume24h?: number | null;
    requestQuery?: string | null;
    tickSize?: number | null;
    lotSize?: number | null;
    minOrderSize?: number | null;
    maxLeverage?: number | null;
}

export interface PacificaMarketUniverseRow {
    symbol: string;
    price: number;
    changePct: number;
    volume24h: number;
    funding?: number | null;
    openInterest?: number | null;
    tickSize?: number | null;
    lotSize?: number | null;
    minOrderSize?: number | null;
    maxLeverage?: number | null;
}

interface DexScreenerPair {
    chainId?: string;
    dexId?: string;
    pairAddress?: string;
    priceUsd?: string | number;
    liquidity?: { usd?: string | number | null };
    volume?: { h24?: string | number | null };
    priceChange?: { h24?: string | number | null };
    baseToken?: {
        symbol?: string;
        name?: string;
        address?: string;
    };
    quoteToken?: {
        symbol?: string;
        address?: string;
    };
}

function tfToMs(tf: string) {
    switch (tf) {
        case '1m': return 60_000;
        case '3m': return 3 * 60_000;
        case '5m': return 5 * 60_000;
        case '15m': return 15 * 60_000;
        case '30m': return 30 * 60_000;
        case '1h': return 60 * 60_000;
        case '2h': return 2 * 60 * 60_000;
        case '4h': return 4 * 60 * 60_000;
        case '8h': return 8 * 60 * 60_000;
        case '12h': return 12 * 60 * 60_000;
        case '1d': return 24 * 60 * 60_000;
        default: return 60 * 60_000;
    }
}

function normalizeAddress(raw: unknown) {
    const value = String(raw || '').trim();
    if (!value)
        return null;

    if (EVM_ADDRESS_PATTERN.test(value))
        return value;
    if (SOLANA_ADDRESS_PATTERN.test(value))
        return value;

    return null;
}

export function normalizeMarketContextSymbol(raw: unknown) {
    const address = normalizeAddress(raw);
    if (address)
        return null;

    const value = String(raw || '')
        .trim()
        .toUpperCase()
        .replace(/^\$/, '')
        .replace(/[^A-Z0-9]/g, '');

    if (!value || value.length < 2 || value.length > 12)
        return null;

    return value;
}

export function normalizeMarketContextQuery(raw: unknown) {
    const address = normalizeAddress(raw);
    if (address)
        return address;

    return normalizeMarketContextSymbol(raw);
}

function toFiniteNumber(value: unknown, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function buildSyntheticCandles(price: number, timeframe: string, limit: number) {
    const boundedLimit = Math.max(2, Math.min(limit, 12));
    const now = Date.now();
    const intervalMs = tfToMs(timeframe);

    return Array.from({ length: boundedLimit }, (_value, index) => ({
        time: now - (boundedLimit - index) * intervalMs,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
    }));
}

async function fetchJson<T>(path: string, search?: Record<string, string>) {
    const url = new URL(`${PACIFICA_PUBLIC_API_BASE}${path}`);
    if (search) {
        Object.entries(search).forEach(([key, value]) => {
            if (value)
                url.searchParams.set(key, value);
        });
    }

    const response = await fetch(url, { method: 'GET' });
    if (!response.ok)
        throw new Error(`Pacifica public API ${path} ${response.status}`);
    return await response.json() as T;
}

async function fetchDexJson<T>(url: string) {
    const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
    });

    if (!response.ok)
        throw new Error(`DexScreener ${response.status}`);

    return await response.json() as T;
}

async function fetchGeckoJson<T>(path: string, search?: Record<string, string>) {
    const url = new URL(`${GECKOTERMINAL_API_BASE}${path}`);
    if (search) {
        for (const [key, value] of Object.entries(search)) {
            if (value)
                url.searchParams.set(key, value);
        }
    }

    const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
    });

    if (!response.ok)
        throw new Error(`GeckoTerminal ${path} ${response.status}`);

    return await response.json() as T;
}

export async function getPacificaSymbolsSet() {
    if (pacificaSymbolsCache && Date.now() - pacificaSymbolsCache.ts < PACIFICA_SYMBOLS_TTL_MS)
        return pacificaSymbolsCache.symbols;

    const contracts = await fetchPacificaContractsMap();
    const symbols = new Set(Object.keys(contracts));
    pacificaSymbolsCache = { ts: Date.now(), symbols };
    return symbols;
}

export async function isPacificaSupportedSymbol(symbol: string) {
    const symbols = await getPacificaSymbolsSet();
    return symbols.has(symbol.toUpperCase());
}

async function fetchPacificaPriceMap() {
    if (pacificaPricesCache && Date.now() - pacificaPricesCache.ts < 10_000)
        return pacificaPricesCache.prices;

    const payload = await fetchJson<{ data?: Array<Record<string, any>> }>('/info/prices');
    const prices: Record<string, any> = {};
    for (const row of payload?.data || []) {
        const symbol = normalizeMarketContextSymbol(row?.symbol);
        if (symbol)
            prices[symbol] = row;
    }
    pacificaPricesCache = { ts: Date.now(), prices };
    return prices;
}

async function fetchPacificaContractsMap() {
    if (pacificaContractsCache && Date.now() - pacificaContractsCache.ts < PACIFICA_SYMBOLS_TTL_MS)
        return pacificaContractsCache.contracts;

    const payload = await fetchJson<{ data?: Array<Record<string, any>> }>('/info');
    const contracts: Record<string, any> = {};
    for (const row of payload?.data || []) {
        const symbol = normalizeMarketContextSymbol(row?.symbol);
        if (symbol)
            contracts[symbol] = row;
    }
    pacificaContractsCache = { ts: Date.now(), contracts };
    return contracts;
}

export async function fetchPacificaMarketUniverse() {
    const [priceMap, contractMap] = await Promise.all([
        fetchPacificaPriceMap(),
        fetchPacificaContractsMap(),
    ]);

    return Object.keys(contractMap)
        .map((symbol) => {
            const contractRow = contractMap[symbol] || {};
            const priceRow = priceMap[symbol] || {};
            const price = Number(priceRow?.mark ?? priceRow?.mid ?? priceRow?.oracle ?? 0);
            const yesterdayPrice = Number(priceRow?.yesterday_price ?? 0);
            const volume24h = Number(priceRow?.volume_24h ?? 0);
            const changePct = Number.isFinite(price) && Number.isFinite(yesterdayPrice) && yesterdayPrice > 0
                ? ((price - yesterdayPrice) / yesterdayPrice) * 100
                : 0;

            return {
                symbol,
                price: Number.isFinite(price) ? price : 0,
                changePct: Number.isFinite(changePct) ? changePct : 0,
                volume24h: Number.isFinite(volume24h) ? volume24h : 0,
                funding: Number.isFinite(Number(priceRow?.funding)) ? Number(priceRow.funding) : null,
                openInterest: Number.isFinite(Number(priceRow?.open_interest)) ? Number(priceRow.open_interest) : null,
                tickSize: Number.isFinite(Number(contractRow?.tick_size)) ? Number(contractRow.tick_size) : null,
                lotSize: Number.isFinite(Number(contractRow?.lot_size)) ? Number(contractRow.lot_size) : null,
                minOrderSize: Number.isFinite(Number(contractRow?.min_order_size)) ? Number(contractRow.min_order_size) : null,
                maxLeverage: Number.isFinite(Number(contractRow?.max_leverage)) ? Number(contractRow.max_leverage) : null,
            } satisfies PacificaMarketUniverseRow;
        })
        .sort((left, right) => right.volume24h - left.volume24h);
}

export async function primePacificaMarketUniverse() {
    await Promise.all([
        fetchPacificaContractsMap(),
        fetchPacificaPriceMap(),
    ]);
}

async function fetchPacificaKlines(symbol: string, interval: string, startTime: number, endTime: number) {
    const payload = await fetchJson<{ data?: Array<Record<string, any>> }>('/kline', {
        symbol,
        interval,
        start_time: String(startTime),
        end_time: String(endTime),
    });
    return Array.isArray(payload?.data) ? payload.data : [];
}

function isContractAddress(query: string) {
    return EVM_ADDRESS_PATTERN.test(query) || SOLANA_ADDRESS_PATTERN.test(query);
}

function resolveGeckoNetwork(rawChainId: unknown) {
    const value = String(rawChainId || '').trim().toLowerCase();
    if (!value)
        return null;

    if (/^\d+$/.test(value))
        return NUMERIC_CHAIN_TO_NETWORK[Number(value)] || null;

    return CHAIN_NETWORK_ALIASES[value] || value;
}

function resolveDexEndpoint(query: string) {
    if (EVM_ADDRESS_PATTERN.test(query))
        return `${DEXSCREENER_API_BASE}/latest/dex/tokens/${query}`;

    return `${DEXSCREENER_API_BASE}/latest/dex/search?q=${encodeURIComponent(query)}`;
}

function pickBestDexPair(query: string, pairs: DexScreenerPair[]) {
    const normalizedQuerySymbol = normalizeMarketContextSymbol(query);
    const normalizedQueryAddress = normalizeAddress(query)?.toLowerCase() || null;
    const scoped = pairs.filter((pair) => {
        const baseAddress = String(pair.baseToken?.address || '').toLowerCase();
        if (normalizedQueryAddress)
            return baseAddress === normalizedQueryAddress;
        if (normalizedQuerySymbol)
            return normalizeMarketContextSymbol(pair.baseToken?.symbol) === normalizedQuerySymbol;
        return true;
    });

    const candidates = scoped.length ? scoped : pairs;
    return candidates.reduce((best, current) => {
        const bestLiquidity = toFiniteNumber(best.liquidity?.usd);
        const currentLiquidity = toFiniteNumber(current.liquidity?.usd);
        if (currentLiquidity !== bestLiquidity)
            return currentLiquidity > bestLiquidity ? current : best;

        const bestVolume = toFiniteNumber(best.volume?.h24);
        const currentVolume = toFiniteNumber(current.volume?.h24);
        return currentVolume > bestVolume ? current : best;
    });
}

function resolveGeckoOhlcvParams(timeframe: string, limit: number) {
    const value = timeframe.toLowerCase();
    const match = value.match(/^(\d+)([mhd])$/);
    if (!match)
        return { path: 'hour', aggregate: 1, limit };

    const amount = Math.max(1, Number(match[1]));
    const unit = match[2];
    if (unit === 'm')
        return { path: 'minute', aggregate: amount, limit };
    if (unit === 'd')
        return { path: 'day', aggregate: amount, limit };
    return { path: 'hour', aggregate: amount, limit };
}

async function fetchGeckoCandles(network: string, poolAddress: string, timeframe: string, limit: number) {
    const { path, aggregate, limit: boundedLimit } = resolveGeckoOhlcvParams(timeframe, limit);
    const payload = await fetchGeckoJson<{ data?: { attributes?: { ohlcv_list?: any[] } } }>(
        `/networks/${network}/pools/${poolAddress}/ohlcv/${path}`,
        {
            aggregate: String(aggregate),
            limit: String(boundedLimit),
        },
    );

    const rows = payload?.data?.attributes?.ohlcv_list || [];
    return rows
        .map((row: any[]) => ({
            time: Number(row?.[0] ?? 0) * 1000,
            open: Number(row?.[1] ?? 0),
            high: Number(row?.[2] ?? 0),
            low: Number(row?.[3] ?? 0),
            close: Number(row?.[4] ?? 0),
            volume: Number(row?.[5] ?? 0),
        }))
        .filter(candle => [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))
        .sort((left, right) => left.time - right.time);
}

async function fetchAlternativeMarketContext(query: string, timeframe: string, limit: number): Promise<MarketContextPayload> {
    const cacheKey = `${query.toLowerCase()}|${timeframe}|${limit}`;
    const cached = externalMarketCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < EXTERNAL_MARKET_CACHE_TTL_MS)
        return cached.payload;

    const dexPayload = await fetchDexJson<{ pairs?: DexScreenerPair[] }>(resolveDexEndpoint(query));
    const pairs = Array.isArray(dexPayload?.pairs) ? dexPayload.pairs.filter(pair => pair?.pairAddress && pair?.baseToken?.symbol) : [];
    if (!pairs.length)
        throw new Error(`No market data found for ${query}`);

    const bestPair = pickBestDexPair(query, pairs);
    const resolvedSymbol = normalizeMarketContextSymbol(bestPair.baseToken?.symbol) || normalizeMarketContextSymbol(query) || 'TOKEN';
    const resolvedChain = resolveGeckoNetwork(bestPair.chainId);
    const currentPrice = toFiniteNumber(bestPair.priceUsd);
    const priceChange24h = toFiniteNumber(bestPair.priceChange?.h24);
    const volume24h = toFiniteNumber(bestPair.volume?.h24);
    const liquidityUsd = toFiniteNumber(bestPair.liquidity?.usd);

    let candles: MarketContextCandle[] = [];
    if (resolvedChain && bestPair.pairAddress) {
        try {
            candles = await fetchGeckoCandles(resolvedChain, bestPair.pairAddress, timeframe, limit);
        }
        catch {
            candles = [];
        }
    }

    if (!candles.length && currentPrice > 0)
        candles = buildSyntheticCandles(currentPrice, timeframe, limit);

    if (!candles.length)
        throw new Error(`No chart context available for ${query}`);

    const sliced = candles.length > limit ? candles.slice(-limit) : candles;
    const first = sliced[0];
    const last = sliced[sliced.length - 1];
    const fallbackChangePct = first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0;
    const high = Math.max(...sliced.map(candle => candle.high));
    const low = Math.min(...sliced.map(candle => candle.low));
    const jupiterSupported = resolvedChain === 'solana' && Boolean(bestPair.baseToken?.address);
    const payload: MarketContextPayload = {
        symbol: resolvedSymbol,
        tf: timeframe,
        provider: candles.length > 2 ? 'geckoterminal' : 'dexscreener',
        venue: 'spot',
        marketSymbol: resolvedSymbol,
        quote: (bestPair.quoteToken?.symbol || 'USD').toUpperCase(),
        price: currentPrice > 0 ? currentPrice : last.close,
        changePct: Math.abs(priceChange24h) > 0 ? priceChange24h : fallbackChangePct,
        high,
        low,
        updatedAt: Date.now(),
        data: sliced,
        funding: null,
        openInterest: null,
        supportedOnPacifica: false,
        supportedOnJupiter: jupiterSupported,
        executionVenue: jupiterSupported ? 'jupiter' : null,
        chainId: resolvedChain || String(bestPair.chainId || ''),
        baseTokenAddress: bestPair.baseToken?.address || null,
        baseTokenName: bestPair.baseToken?.name || null,
        pairAddress: bestPair.pairAddress || null,
        liquidityUsd: liquidityUsd > 0 ? liquidityUsd : null,
        volume24h: volume24h > 0 ? volume24h : null,
        requestQuery: query,
        tickSize: null,
        lotSize: null,
        minOrderSize: null,
        maxLeverage: null,
    };

    externalMarketCache.set(cacheKey, { ts: Date.now(), payload });
    return payload;
}

async function fetchPacificaMarketContext(symbol: string, timeframe: string, limit: number): Promise<MarketContextPayload> {
    const now = Date.now();
    let startTime = now - limit * tfToMs(timeframe);
    let rows = await fetchPacificaKlines(symbol, timeframe, startTime, now);

    let retries = 0;
    while (rows.length < limit && retries < 5) {
        retries += 1;
        startTime -= limit * tfToMs(timeframe);
        rows = await fetchPacificaKlines(symbol, timeframe, startTime, now);
    }

    const candles = rows
        .map((row) => ({
            time: Number(row?.t ?? 0),
            open: Number(row?.o ?? 0),
            high: Number(row?.h ?? 0),
            low: Number(row?.l ?? 0),
            close: Number(row?.c ?? 0),
            volume: Number(row?.v ?? 0),
        }))
        .filter(candle => [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))
        .sort((left, right) => left.time - right.time);

    if (!candles.length)
        throw new Error(`No market context available for ${symbol}`);

    const sliced = candles.length > limit ? candles.slice(-limit) : candles;
    const first = sliced[0];
    const last = sliced[sliced.length - 1];
    const changePct = first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0;
    const high = Math.max(...sliced.map(candle => candle.high));
    const low = Math.min(...sliced.map(candle => candle.low));
    const priceMap = await fetchPacificaPriceMap();
    const contractMap = await fetchPacificaContractsMap();
    const priceRow = priceMap[symbol] || {};
    const contractRow = contractMap[symbol] || {};
    const mark = Number(priceRow?.mark ?? priceRow?.mid ?? last.close);

    return {
        symbol,
        tf: timeframe,
        provider: 'pacifica',
        venue: 'perp',
        marketSymbol: symbol,
        quote: 'USD',
        price: Number.isFinite(mark) ? mark : last.close,
        changePct,
        high,
        low,
        updatedAt: Date.now(),
        data: sliced,
        funding: Number.isFinite(Number(priceRow?.funding)) ? Number(priceRow.funding) : null,
        openInterest: Number.isFinite(Number(priceRow?.open_interest)) ? Number(priceRow.open_interest) : null,
        supportedOnPacifica: true,
        supportedOnJupiter: false,
        executionVenue: 'pacifica',
        chainId: null,
        baseTokenAddress: null,
        baseTokenName: null,
        pairAddress: null,
        liquidityUsd: null,
        volume24h: toFiniteNumber(priceRow?.volume_24h, 0) || null,
        requestQuery: symbol,
        tickSize: Number.isFinite(Number(contractRow?.tick_size)) ? Number(contractRow.tick_size) : null,
        lotSize: Number.isFinite(Number(contractRow?.lot_size)) ? Number(contractRow.lot_size) : null,
        minOrderSize: Number.isFinite(Number(contractRow?.min_order_size)) ? Number(contractRow.min_order_size) : null,
        maxLeverage: Number.isFinite(Number(contractRow?.max_leverage)) ? Number(contractRow.max_leverage) : null,
    };
}

export async function fetchMarketContext(query: string, timeframe = '1h', limit = 96): Promise<MarketContextPayload> {
    const normalizedQuery = normalizeMarketContextQuery(query);
    if (!normalizedQuery)
        throw new Error('Invalid market query');

    const resolvedTimeframe = SUPPORTED_INTERVALS.has(timeframe.toLowerCase()) ? timeframe.toLowerCase() : '1h';
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 48), 240);
    const normalizedSymbol = normalizeMarketContextSymbol(normalizedQuery);

    if (normalizedSymbol && await isPacificaSupportedSymbol(normalizedSymbol))
        return await fetchPacificaMarketContext(normalizedSymbol, resolvedTimeframe, boundedLimit);

    return await fetchAlternativeMarketContext(normalizedQuery, resolvedTimeframe, boundedLimit);
}
