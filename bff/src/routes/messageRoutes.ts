import {Router} from "express";
import {getRequiredSession, requireAuthenticatedSession} from "../middleware/requireSession";
import {requestUpstreamJson} from "../upstream/client";
import {asyncRoute} from "../util/asyncRoute";

const router = Router();

router.use(requireAuthenticatedSession);

router.post("/message/query", asyncRoute(async (req, res) => {
        const session = getRequiredSession(req);
        const payload = await requestUpstreamJson<unknown>(session, {
                method: "POST",
                path: "/api/v1/message/query",
                body: req.body
        });
        res.json(payload);
}));

export default router;
