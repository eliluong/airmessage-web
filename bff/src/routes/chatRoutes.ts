import {Router} from "express";
import {getRequiredSession, requireAuthenticatedSession} from "../middleware/requireSession";
import {requestUpstreamJson, toUpstreamQuery} from "../upstream/client";
import {asyncRoute} from "../util/asyncRoute";

const router = Router();

router.use(requireAuthenticatedSession);

router.post("/chat/query", asyncRoute(async (req, res) => {
        const session = getRequiredSession(req);
        const payload = await requestUpstreamJson<unknown>(session, {
                method: "POST",
                path: "/api/v1/chat/query",
                body: req.body
        });
        res.json(payload);
}));

router.get("/chat/count", asyncRoute(async (req, res) => {
        const session = getRequiredSession(req);
        const payload = await requestUpstreamJson<unknown>(session, {
                method: "GET",
                path: "/api/v1/chat/count",
                query: toUpstreamQuery(req.query)
        });
        res.json(payload);
}));

router.get("/chat/:guid", asyncRoute(async (req, res) => {
        const session = getRequiredSession(req);
        const payload = await requestUpstreamJson<unknown>(session, {
                method: "GET",
                path: `/api/v1/chat/${encodeURIComponent(req.params.guid)}`,
                query: toUpstreamQuery(req.query)
        });
        res.json(payload);
}));

router.get("/chat/:guid/message", asyncRoute(async (req, res) => {
        const session = getRequiredSession(req);
        const payload = await requestUpstreamJson<unknown>(session, {
                method: "GET",
                path: `/api/v1/chat/${encodeURIComponent(req.params.guid)}/message`,
                query: toUpstreamQuery(req.query)
        });
        res.json(payload);
}));

export default router;
