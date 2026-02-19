import {createServer} from "node:http";
import {loadConfig} from "./config";
import {createApp} from "./app";
import {logger} from "./observability/logger";
import {attachRealtimeBridge} from "./realtime/bridge";
import {BFF_SOCKET_PATH} from "./realtime/contracts";
import {createSessionMiddleware} from "./session/middleware";

async function main() {
        const config = loadConfig();
        const sessionMiddleware = createSessionMiddleware(config);
        const app = createApp(config, sessionMiddleware);
        const httpServer = createServer(app);
        attachRealtimeBridge(httpServer, config, sessionMiddleware);

        httpServer.listen(config.port, () => {
                logger.info({
                        port: config.port,
                        cookieSecure: config.cookieSecure,
                        allowedOrigins: config.allowedOrigins,
                        socketPath: BFF_SOCKET_PATH
                }, "BFF server listening");
        });
}

void main();
