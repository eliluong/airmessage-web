import {Request, Router} from "express";
import "express-session";
import {BffHttpError} from "../errors";
import {authenticateUpstream, sanitizeSessionLoginRequest} from "../upstream/auth";
import {SessionStatusPayload} from "../session/types";
import {asyncRoute} from "../util/asyncRoute";
import {ensureSessionCsrfToken} from "../session/csrf";
import {requireAuthenticatedSession} from "../middleware/requireSession";
import {requireCsrfToken} from "../middleware/csrf";

const router = Router();

router.post("/session/login", asyncRoute(async (req, res) => {
        const credentials = sanitizeSessionLoginRequest(req.body);
        const sessionRecord = ensureSessionCsrfToken(await authenticateUpstream(credentials));

        req.session.bffSession = sessionRecord;
        await saveSession(req);

        const payload: SessionStatusPayload = buildSessionStatusPayload(req);
        res.json({data: payload});
}));

router.get("/session/status", asyncRoute(async (req, res) => {
        const payload: SessionStatusPayload = buildSessionStatusPayload(req);

        res.json({data: payload});
}));

router.post("/session/logout", requireAuthenticatedSession, requireCsrfToken, asyncRoute(async (req, res) => {
        await destroySession(req);
        res.json({data: {success: true}});
}));

export default router;

function buildSessionStatusPayload(req: Request): SessionStatusPayload {
        const sessionRecord = req.session.bffSession;
        if(!sessionRecord) {
                return {authenticated: false};
        }

        const normalizedSessionRecord = ensureSessionCsrfToken(sessionRecord);
        req.session.bffSession = normalizedSessionRecord;

        return {
                authenticated: true,
                serverUrl: normalizedSessionRecord.serverUrl,
                deviceName: normalizedSessionRecord.deviceName,
                authMode: normalizedSessionRecord.authMode,
                csrfToken: normalizedSessionRecord.csrfToken
        };
}

function saveSession(req: Request): Promise<void> {
        return new Promise((resolve, reject) => {
                req.session.save((error: unknown) => {
                        if(error) {
                                reject(new BffHttpError({
                                        code: "BFF_SESSION_SAVE_FAILED",
                                        status: 500,
                                        message: error instanceof Error ? error.message : "Failed to persist session."
                                }));
                                return;
                        }
                        resolve();
                });
        });
}

function destroySession(req: Request): Promise<void> {
        return new Promise((resolve, reject) => {
                req.session.destroy((error: unknown) => {
                        if(error) {
                                reject(new BffHttpError({
                                        code: "BFF_SESSION_DESTROY_FAILED",
                                        status: 500,
                                        message: error instanceof Error ? error.message : "Failed to destroy session."
                                }));
                                return;
                        }
                        resolve();
                });
        });
}
