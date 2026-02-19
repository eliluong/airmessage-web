import express, {Express, NextFunction, Request, RequestHandler, Response} from "express";
import helmet from "helmet";
import {BffHttpError} from "./errors";
import {BffConfig} from "./config";
import {requestIdMiddleware} from "./middleware/requestId";
import {errorHandler, notFoundHandler} from "./middleware/errorHandler";
import createSessionRoutes from "./routes/sessionRoutes";
import serverRoutes from "./routes/serverRoutes";
import chatRoutes from "./routes/chatRoutes";
import messageRoutes from "./routes/messageRoutes";
import attachmentRoutes from "./routes/attachmentRoutes";
import {createRateLimiters} from "./security/rateLimit";
import {getMetricsContentType, renderMetrics} from "./observability/metrics";

export function createApp(config: BffConfig, sessionMiddleware: RequestHandler): Express {
        const app = express();
        const sessionRoutes = createSessionRoutes(config);
        const rateLimiters = createRateLimiters(config);

        if(config.trustProxy) {
                app.set("trust proxy", 1);
        }

        app.use(helmet());
        app.use(requestIdMiddleware);
        app.use(express.json({limit: config.requestBodyLimit}));

        app.use((req: Request, res: Response, next: NextFunction) => {
                if(!config.allowedOrigins || config.allowedOrigins.length === 0) {
                        next();
                        return;
                }

                const origin = req.header("origin");
                if(origin && config.allowedOrigins.includes(origin)) {
                        res.header("Access-Control-Allow-Origin", origin);
                        res.header("Access-Control-Allow-Credentials", "true");
                        res.header("Vary", "Origin");
                        res.header("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
                        res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                }

                if(req.method === "OPTIONS") {
                        res.status(204).send();
                        return;
                }
                next();
        });

        app.use(sessionMiddleware);
        app.use("/bff/session/login", rateLimiters.auth);
        app.use("/bff", rateLimiters.proxy);

        if(config.metricsEnabled) {
                app.get("/bff/metrics", async (req: Request, res: Response, next: NextFunction) => {
                        try {
                                requireMetricsAccess(req, config);
                                const payload = await renderMetrics();
                                res.setHeader("Content-Type", getMetricsContentType());
                                res.send(payload);
                        } catch(error) {
                                next(error);
                        }
                });
        }

        app.use("/bff", sessionRoutes);
        app.use("/bff", serverRoutes);
        app.use("/bff", chatRoutes);
        app.use("/bff", messageRoutes);
        app.use("/bff", attachmentRoutes);

        app.use(notFoundHandler);
        app.use(errorHandler);

        return app;
}

function requireMetricsAccess(req: Request, config: BffConfig): void {
        const expectedToken = config.metricsBearerToken;
        if(!expectedToken) {
                return;
        }

        const authorizationHeader = req.header("authorization")?.trim();
        const expectedHeaderValue = `Bearer ${expectedToken}`;
        if(authorizationHeader === expectedHeaderValue) {
                return;
        }

        throw new BffHttpError({
                code: "BFF_METRICS_UNAUTHORIZED",
                status: 401,
                message: "Metrics endpoint requires authorization."
        });
}
