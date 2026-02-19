import {Request, Router} from "express";
import "express-session";
import {BffHttpError} from "../errors";
import {authenticateUpstream, sanitizeSessionLoginRequest} from "../upstream/auth";
import {SessionStatusPayload} from "../session/types";
import {asyncRoute} from "../util/asyncRoute";

const router = Router();

router.post("/session/login", asyncRoute(async (req, res) => {
        const credentials = sanitizeSessionLoginRequest(req.body);
        const sessionRecord = await authenticateUpstream(credentials);

        req.session.bffSession = sessionRecord;
        await saveSession(req);

        const payload: SessionStatusPayload = {
                authenticated: true,
                serverUrl: sessionRecord.serverUrl,
                deviceName: sessionRecord.deviceName,
                authMode: sessionRecord.authMode
        };
        res.json({data: payload});
}));

router.get("/session/status", asyncRoute(async (req, res) => {
        const sessionRecord = req.session.bffSession;
        const payload: SessionStatusPayload = sessionRecord
                ? {
                        authenticated: true,
                        serverUrl: sessionRecord.serverUrl,
                        deviceName: sessionRecord.deviceName,
                        authMode: sessionRecord.authMode
                }
                : {authenticated: false};

        res.json({data: payload});
}));

router.post("/session/logout", asyncRoute(async (req, res) => {
        await destroySession(req);
        res.json({data: {success: true}});
}));

export default router;

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
