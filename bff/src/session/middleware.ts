import session from "express-session";
import {RedisStore} from "connect-redis";
import {createClient} from "redis";
import {BffConfig} from "../config";

export type BffSessionMiddleware = ReturnType<typeof session>;

export interface BffSessionRuntime {
        middleware: BffSessionMiddleware;
        storeMode: BffConfig["sessionStoreMode"];
        close(): Promise<void>;
}

export async function createSessionRuntime(config: BffConfig): Promise<BffSessionRuntime> {
        if(config.sessionStoreMode === "redis") {
                const redisClient = await createRedisClient(config);
                const middleware = buildSessionMiddleware(config, new RedisStore({
                        client: redisClient,
                        prefix: config.redisKeyPrefix,
                        ttl: config.sessionStoreTtlSeconds,
                        disableTouch: false
                }));

                return {
                        middleware,
                        storeMode: "redis",
                        close: async () => {
                                if(redisClient.isOpen) {
                                        await redisClient.quit();
                                }
                        }
                };
        }

        return {
                middleware: buildSessionMiddleware(config),
                storeMode: "memory",
                close: async () => undefined
        };
}

function buildSessionMiddleware(config: BffConfig, store?: session.Store): BffSessionMiddleware {
        return session({
                name: config.sessionCookieName,
                secret: config.sessionSecret,
                store,
                resave: false,
                saveUninitialized: false,
                rolling: true,
                proxy: config.trustProxy,
                cookie: {
                        httpOnly: true,
                        secure: config.cookieSecure,
                        sameSite: "strict",
                        maxAge: config.sessionMaxAgeMs
                }
        });
}

async function createRedisClient(config: BffConfig): Promise<ReturnType<typeof createClient>> {
        const redisClient = createClient({
                url: config.redisUrl
        });
        await redisClient.connect();
        return redisClient;
}
