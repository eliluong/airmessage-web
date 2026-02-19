import {NextFunction, Request, Response} from "express";
import {BffHttpError} from "../errors";
import {getRequiredSession} from "./requireSession";
import {CSRF_HEADER_NAME, isValidCsrfToken} from "../session/csrf";

export function requireCsrfToken(req: Request, _res: Response, next: NextFunction): void {
        const sessionRecord = getRequiredSession(req);
        const csrfHeader = req.header(CSRF_HEADER_NAME) ?? undefined;
        const providedToken = typeof csrfHeader === "string" ? csrfHeader : undefined;

        if(!isValidCsrfToken(sessionRecord.csrfToken, providedToken)) {
                next(new BffHttpError({
                        code: "BFF_CSRF_TOKEN_INVALID",
                        status: 403,
                        message: "Invalid CSRF token.",
                        retriable: false
                }));
                return;
        }

        next();
}
