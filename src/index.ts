import { elizaLogger } from "@elizaos/core";
import type { Client, IAgentRuntime } from "@elizaos/core";
import { AirificaClient } from "./airificaClient.ts";
import { AirificaMessageManager } from "./messageManager.ts";
import { AirificaServer } from "./server.ts";

export { AirificaClient } from "./airificaClient.ts";
export { AirificaMessageManager } from "./messageManager.ts";
export { AirificaServer } from "./server.ts";
export * from "./types.ts";

export const AirificaClientInterface: Client = {
    start: async (runtime: IAgentRuntime) => {
        const client = new AirificaClient(runtime);
        const ok = await client.start();
        if (!ok) {
            elizaLogger.warn("[client-airifica] server failed to start");
            return null;
        }
        return client;
    },
    stop: async (_runtime: IAgentRuntime) => {
        elizaLogger.warn("[client-airifica] stop called (no-op for now)");
    },
};

export default AirificaClientInterface;
