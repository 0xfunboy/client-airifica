export interface TradeProposal {
    symbol: string;
    side: "LONG" | "SHORT";
    entry: number;
    tp: number;
    sl: number;
    timeframe: string;
    confidence: number;
    thesis: string;
    sourceAction: string;
}

export interface AirificaMessageContent {
    text?: string;
    image?: string;
    action?: string;
    proposal?: TradeProposal;
    meta?: {
        source: string;
        provider?: string;
    };
}

export interface AirificaMessageEnvelope {
    ok: boolean;
    conversationId: string;
    message: AirificaMessageContent;
    error?: string;
}

export interface AirificaProposalRequest {
    conversationId?: string;
    message: AirificaMessageContent;
}

export interface AirificaProposalResponse {
    ok: boolean;
    proposal: TradeProposal | null;
}

export interface AirificaSessionRequest {
    walletAddress: string;
    conversationId?: string;
}

export interface AirificaSessionResponse {
    ok: boolean;
    conversationId: string;
    userId: string;
    roomId: string;
}

export interface AirificaIncomingMessage {
    walletAddress: string;
    conversationId: string;
    text: string;
}

export interface ConnectedClient {
    walletAddress: string;
    conversationId: string;
    userId: string;
    roomId: string;
    ws?: any; // WebSocket
}
