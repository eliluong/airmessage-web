import express, {Express, NextFunction, Request, RequestHandler, Response} from "express";
import helmet from "helmet";
import {BffConfig} from "./config";
import {requestIdMiddleware} from "./middleware/requestId";
import {errorHandler, notFoundHandler} from "./middleware/errorHandler";
import sessionRoutes from "./routes/sessionRoutes";
import serverRoutes from "./routes/serverRoutes";
import chatRoutes from "./routes/chatRoutes";
import messageRoutes from "./routes/messageRoutes";
import attachmentRoutes from "./routes/attachmentRoutes";

export function createApp(config: BffConfig, sessionMiddleware: RequestHandler): Express {
        const app = express();
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

        app.use("/bff", sessionRoutes);
        app.use("/bff", serverRoutes);
        app.use("/bff", chatRoutes);
        app.use("/bff", messageRoutes);
        app.use("/bff", attachmentRoutes);

        app.use(notFoundHandler);
        app.use(errorHandler);

        return app;
}
