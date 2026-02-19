import {createServer} from "node:http";
import {loadConfig} from "./config";
import {createApp} from "./app";
import {logger} from "./observability/logger";
import {attachRealtimeBridge} from "./realtime/bridge";
import {BFF_SOCKET_PATH} from "./realtime/contracts";
import {createSessionRuntime} from "./session/middleware";

async function main() {
        const config = loadConfig();
        const sessionRuntime = await createSessionRuntime(config);
        const app = createApp(config, sessionRuntime.middleware);
        const httpServer = createServer(app);
        attachRealtimeBridge(httpServer, config, sessionRuntime.middleware);

        httpServer.listen(config.port, () => {
                logger.info({
                        port: config.port,
                        cookieSecure: config.cookieSecure,
                        allowedOrigins: config.allowedOrigins,
                        sessionStoreMode: sessionRuntime.storeMode,
                        metricsEnabled: config.metricsEnabled,
                        socketPath: BFF_SOCKET_PATH
                }, "BFF server listening");
        });

        const shutdown = async (signal: NodeJS.Signals) => {
                logger.info({signal}, "Shutting down BFF server");
                httpServer.close(async () => {
                        await sessionRuntime.close();
                        process.exit(0);
                });
        };

        process.once("SIGINT", () => void shutdown("SIGINT"));
        process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

void main().catch((error) => {
        logger.fatal({
                message: error instanceof Error ? error.message : String(error)
        }, "BFF server failed to start");
        process.exit(1);
});
