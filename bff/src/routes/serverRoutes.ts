import {Router} from "express";
import {getRequiredSession, requireAuthenticatedSession} from "../middleware/requireSession";
import {requestUpstreamJson, toUpstreamQuery} from "../upstream/client";
import {asyncRoute} from "../util/asyncRoute";

const router = Router();

router.get("/general/ping", requireAuthenticatedSession, asyncRoute(async (req, res) => {
        const session = getRequiredSession(req);
        const payload = await requestUpstreamJson<unknown>(session, {
                method: "GET",
                path: "/api/v1/general/ping",
                query: toUpstreamQuery(req.query)
        });
        res.json(payload);
}));

router.get("/server/info", requireAuthenticatedSession, asyncRoute(async (req, res) => {
        const session = getRequiredSession(req);
        const payload = await requestUpstreamJson<unknown>(session, {
                method: "GET",
                path: "/api/v1/server/info",
                query: toUpstreamQuery(req.query)
        });
        res.json(payload);
}));

router.get("/server/features", requireAuthenticatedSession, asyncRoute(async (req, res) => {
        const session = getRequiredSession(req);
        const payload = await requestUpstreamJson<unknown>(session, {
                method: "GET",
                path: "/api/v1/server/features",
                query: toUpstreamQuery(req.query)
        });
        res.json(payload);
}));

router.get("/socket", requireAuthenticatedSession, (_req, res) => {
        res.status(501).json({
                error: {
                        code: "BFF_SOCKET_NOT_IMPLEMENTED",
                        message: "Realtime socket proxy is not implemented in Phase 1.",
                        status: 501
                }
        });
});

export default router;
