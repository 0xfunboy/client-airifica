export {
    Airi3Client,
    Airi3ClientInterface,
    Airi3MessageManager,
    Airi3Server,
} from "@elizaos/client-airi3";

export {
    Airi3Client as AirificaClient,
    Airi3MessageManager as AirificaMessageManager,
    Airi3Server as AirificaServer,
    Airi3ClientInterface as AirificaClientInterface,
} from "@elizaos/client-airi3";

import { Airi3ClientInterface } from "@elizaos/client-airi3";

declare const AirificaClientInterfaceDefault: typeof Airi3ClientInterface;

export default AirificaClientInterfaceDefault;
