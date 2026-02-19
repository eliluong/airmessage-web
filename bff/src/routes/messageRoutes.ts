import {Readable} from "node:stream";
import {Router} from "express";
import {BffHttpError} from "../errors";
import {requireCsrfToken} from "../middleware/csrf";
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

router.post("/message/text", requireCsrfToken, asyncRoute(async (req, res) => {
        const session = getRequiredSession(req);
        const payload = await requestUpstreamJson<unknown>(session, {
                method: "POST",
                path: "/api/v1/message/text",
                body: req.body
        });
        res.json(payload);
}));

router.post("/message/attachment", requireCsrfToken, asyncRoute(async (req, res) => {
        const session = getRequiredSession(req);
        const contentType = req.header("content-type");
        if(!contentType) {
                throw new BffHttpError({
                        code: "BFF_ATTACHMENT_CONTENT_TYPE_REQUIRED",
                        status: 400,
                        message: "Attachment uploads must include a Content-Type header."
                });
        }

        const payload = await requestUpstreamJson<unknown>(session, {
                method: "POST",
                path: "/api/v1/message/attachment",
                headers: {
                        "Content-Type": contentType,
                        "Content-Length": req.header("content-length")
                },
                rawBody: Readable.toWeb(req) as unknown as BodyInit
        });
        res.json(payload);
}));

export default router;
