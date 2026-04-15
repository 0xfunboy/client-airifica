import crypto from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

function envValue(name: string, fallback = '') {
    return process.env[`AIRIFICA_${name}`] ?? process.env[`AIRI3_${name}`] ?? fallback;
}

const NONCE_TTL_MS = Number(envValue('NONCE_TTL_MS', String(5 * 60 * 1000)));
const AUTH_TOKEN_TTL_MS = Number(envValue('AUTH_TOKEN_TTL_MS', String(24 * 60 * 60 * 1000)));
const AUTH_ISSUER = envValue('AUTH_ISSUER', 'airifica-local');
const AUTH_AUDIENCE = envValue('AUTH_AUDIENCE', 'airifica-clients');

const NONCE_STORE = new Map<string, { address: string; expires: number }>();
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Map(BASE58_ALPHABET.split('').map((char, index) => [char, index]));

let cachedSecret: Buffer | null = null;

function getAuthSecret() {
    if (cachedSecret)
        return cachedSecret;

    const configured = envValue('AUTH_SECRET').trim();
    if (configured) {
        cachedSecret = crypto.createHash('sha256').update(configured).digest();
        return cachedSecret;
    }

    cachedSecret = crypto.randomBytes(32);
    return cachedSecret;
}

function base64UrlEncode(input: Buffer | string) {
    const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input: string) {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(`${normalized}${padding}`, 'base64');
}

export function base58Encode(bytes: Uint8Array) {
    if (!bytes.length)
        return '';

    const digits = [0];
    for (const byte of bytes) {
        let carry = byte;
        for (let index = 0; index < digits.length; index += 1) {
            const value = digits[index] * 256 + carry;
            digits[index] = value % 58;
            carry = Math.floor(value / 58);
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = Math.floor(carry / 58);
        }
    }

    let leadingZeroes = 0;
    while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0)
        leadingZeroes += 1;

    let encoded = ''.padStart(leadingZeroes, BASE58_ALPHABET[0]);
    for (let index = digits.length - 1; index >= 0; index -= 1)
        encoded += BASE58_ALPHABET[digits[index]];

    return encoded;
}

export function base58Decode(value: string): Buffer | null {
    if (!value)
        return null;

    let bytes = [0];
    for (const char of value) {
        const mapped = BASE58_MAP.get(char);
        if (mapped === undefined)
            return null;

        let carry = mapped;
        for (let index = 0; index < bytes.length; index += 1) {
            const next = bytes[index] * 58 + carry;
            bytes[index] = next & 0xff;
            carry = next >> 8;
        }

        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }

    for (const char of value) {
        if (char !== '1')
            break;
        bytes.push(0);
    }

    return Buffer.from(bytes.reverse());
}

export function isValidSolanaAddress(address: string) {
    try {
        new PublicKey(String(address || '').trim());
        return true;
    }
    catch {
        return false;
    }
}

export function buildSolanaAuthMessage(address: string, nonce: string, host: string) {
    return [
        'Airifica Pacifica session authentication',
        `Host: ${host}`,
        `Address: ${address}`,
        `Nonce: ${nonce}`,
        `Issued At: ${new Date().toISOString()}`,
    ].join('\n');
}

export function parseSolanaAuthMessage(message: string): { address: string; nonce: string } | null {
    const addressMatch = message.match(/^Address:\s*(.+)$/m);
    const nonceMatch = message.match(/^Nonce:\s*(.+)$/m);
    if (!addressMatch || !nonceMatch)
        return null;

    return {
        address: addressMatch[1].trim(),
        nonce: nonceMatch[1].trim(),
    };
}

export function createNonce(address: string) {
    const nonce = crypto.randomBytes(16).toString('hex');
    NONCE_STORE.set(nonce, {
        address: address.trim(),
        expires: Date.now() + NONCE_TTL_MS,
    });
    return nonce;
}

export function pruneNonces() {
    const now = Date.now();
    for (const [nonce, entry] of NONCE_STORE.entries()) {
        if (entry.expires < now)
            NONCE_STORE.delete(nonce);
    }
}

export function consumeNonce(nonce: string, address: string) {
    const entry = NONCE_STORE.get(nonce);
    if (!entry)
        return false;

    NONCE_STORE.delete(nonce);
    if (entry.expires < Date.now())
        return false;

    return entry.address === address.trim();
}

export function verifySolanaSignature(address: string, message: string, signatureBase64: string) {
    const publicKey = base58Decode(address);
    if (!publicKey || publicKey.length !== 32)
        return false;

    const signature = Buffer.from(signatureBase64, 'base64');
    if (!signature.length)
        return false;

    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const spkiKey = Buffer.concat([spkiPrefix, publicKey]);

    try {
        const keyObject = crypto.createPublicKey({ key: spkiKey, format: 'der', type: 'spki' });
        return crypto.verify(null, Buffer.from(message, 'utf8'), keyObject, signature);
    } catch {
        return false;
    }
}

export interface AirificaAuthTokenPayload {
    address: string;
    isAdmin: boolean;
    iat: number;
    exp: number;
    iss: string;
    aud: string;
}

export function signAuthToken(address: string, isAdmin = false) {
    const payload: AirificaAuthTokenPayload = {
        address,
        isAdmin,
        iat: Date.now(),
        exp: Date.now() + AUTH_TOKEN_TTL_MS,
        iss: AUTH_ISSUER,
        aud: AUTH_AUDIENCE,
    };

    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = crypto
        .createHmac('sha256', getAuthSecret())
        .update(encodedPayload)
        .digest();

    return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

export function verifyAuthToken(token: string): AirificaAuthTokenPayload {
    const [payloadPart, signaturePart] = String(token || '').split('.');
    if (!payloadPart || !signaturePart)
        throw new Error('Malformed token');

    const expectedSignature = crypto
        .createHmac('sha256', getAuthSecret())
        .update(payloadPart)
        .digest();

    const actualSignature = base64UrlDecode(signaturePart);
    if (expectedSignature.length !== actualSignature.length || !crypto.timingSafeEqual(expectedSignature, actualSignature))
        throw new Error('Invalid token signature');

    const payload = JSON.parse(base64UrlDecode(payloadPart).toString('utf8')) as AirificaAuthTokenPayload;
    if (!payload?.address || payload.iss !== AUTH_ISSUER || payload.aud !== AUTH_AUDIENCE)
        throw new Error('Invalid token payload');
    if (!isValidSolanaAddress(payload.address))
        throw new Error('Invalid token address');
    if (payload.exp < Date.now())
        throw new Error('Token expired');

    return payload;
}
