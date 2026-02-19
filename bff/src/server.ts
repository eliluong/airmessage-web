import {loadConfig} from "./config";
import {createApp} from "./app";
import {logger} from "./observability/logger";

async function main() {
        const config = loadConfig();
        const app = createApp(config);

        app.listen(config.port, () => {
                logger.info({
                        port: config.port,
                        cookieSecure: config.cookieSecure,
                        allowedOrigins: config.allowedOrigins
                }, "BFF server listening");
        });
}

void main();
