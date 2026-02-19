import session from "express-session";
import {BffConfig} from "../config";

export type BffSessionMiddleware = ReturnType<typeof session>;

export function createSessionMiddleware(config: BffConfig): BffSessionMiddleware {
        return session({
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
        });
}
