import {NextFunction, Request, Response} from "express";
import "express-session";
import {BffHttpError} from "../errors";
import {BffSessionRecord} from "../session/types";

export function requireAuthenticatedSession(req: Request, _res: Response, next: NextFunction): void {
        const sessionRecord = req.session.bffSession;
        if(!sessionRecord) {
                next(new BffHttpError({
                        code: "BFF_SESSION_MISSING",
                        status: 401,
                        message: "Not signed in.",
                        retriable: false
                }));
                return;
        }

        req.session.bffSession = {
                ...sessionRecord,
                updatedAt: Date.now()
        };
        next();
}

export function getRequiredSession(req: Request): BffSessionRecord {
        const sessionRecord = req.session.bffSession;
        if(!sessionRecord) {
                throw new BffHttpError({
                        code: "BFF_SESSION_MISSING",
                        status: 401,
                        message: "Not signed in.",
                        retriable: false
                });
        }
        return sessionRecord;
}
