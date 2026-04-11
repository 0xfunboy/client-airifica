import { elizaLogger, type IAgentRuntime } from "@elizaos/core";
import { AirificaServer } from "./server.ts";

const DEFAULT_PORT = Number(process.env.AIRIFICA_PORT || process.env.AIRI3_PORT || 4040);

/**
 * AirificaClient wraps the HTTP+WS server and manages its lifecycle.
 */
export class AirificaClient {
    private server: AirificaServer;
    private runtime: IAgentRuntime;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
        const port = Number(
            runtime.getSetting("AIRIFICA_PORT")
            || runtime.getSetting("AIRI3_PORT")
            || process.env.AIRIFICA_PORT
            || process.env.AIRI3_PORT
            || DEFAULT_PORT,
        );
        this.server = new AirificaServer(runtime, port);
        elizaLogger.log("[client-airifica] AirificaClient constructed");
    }

    public async start(): Promise<boolean> {
        elizaLogger.log("[client-airifica] starting Airifica runtime...");
        const ok = await this.server.start();
        if (ok) {
            elizaLogger.success(
                `[client-airifica] started for character: ${this.runtime.character.name}`,
            );
        }
        return ok;
    }

    public async stop(): Promise<void> {
        this.server.stop();
    }
}
