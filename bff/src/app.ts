import express, {Express, Request, Response, NextFunction} from "express";
import helmet from "helmet";
import session from "express-session";
import {BffConfig} from "./config";
import {requestIdMiddleware} from "./middleware/requestId";
import {errorHandler, notFoundHandler} from "./middleware/errorHandler";
import sessionRoutes from "./routes/sessionRoutes";
import serverRoutes from "./routes/serverRoutes";
import chatRoutes from "./routes/chatRoutes";
import messageRoutes from "./routes/messageRoutes";

export function createApp(config: BffConfig): Express {
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

        app.use(session({
                name: config.sessionCookieName,
                secret: config.sessionSecret,
                resave: false,
                saveUninitialized: false,
                rolling: true,
                cookie: {
                        httpOnly: true,
                        secure: config.cookieSecure,
                        sameSite: "strict",
                        maxAge: config.sessionMaxAgeMs
                }
        }));

        app.use("/bff", sessionRoutes);
        app.use("/bff", serverRoutes);
        app.use("/bff", chatRoutes);
        app.use("/bff", messageRoutes);

        app.use(notFoundHandler);
        app.use(errorHandler);

        return app;
}
