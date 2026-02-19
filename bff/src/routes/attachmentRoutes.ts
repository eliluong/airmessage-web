import {once} from "node:events";
import {Router} from "express";
import {getRequiredSession, requireAuthenticatedSession} from "../middleware/requireSession";
import {requestUpstreamResponse, toUpstreamQuery} from "../upstream/client";
import {asyncRoute} from "../util/asyncRoute";

const HOP_BY_HOP_HEADERS = new Set([
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "set-cookie"
]);

const router = Router();

router.use(requireAuthenticatedSession);

router.get("/attachment/:guid/download", asyncRoute(async (req, res) => {
        const session = getRequiredSession(req);
        const abortController = new AbortController();
        const abortUpstream = () => {
                abortController.abort();
        };

        req.on("aborted", abortUpstream);
        req.on("close", abortUpstream);

        try {
                const upstreamResponse = await requestUpstreamResponse(session, {
                        method: "GET",
                        path: `/api/v1/attachment/${encodeURIComponent(req.params.guid)}/download`,
                        query: toUpstreamQuery(req.query),
                        signal: abortController.signal
                });

                res.status(upstreamResponse.status);
                forwardHeaders(upstreamResponse, res);

                const bodyStream = upstreamResponse.body;
                if(!bodyStream) {
                        res.end();
                        return;
                }

                try {
                        const reader = bodyStream.getReader();
                        while(true) {
                                const {done, value} = await reader.read();
                                if(done) {
                                        break;
                                }
                                if(!value) {
                                        continue;
                                }

                                const canContinue = res.write(Buffer.from(value));
                                if(!canContinue) {
                                        await once(res, "drain");
                                }
                        }
                } catch(error) {
                        if(abortController.signal.aborted) {
                                return;
                        }
                        throw error;
                }

                res.end();
        } finally {
                req.off("aborted", abortUpstream);
                req.off("close", abortUpstream);
        }
}));

export default router;

function forwardHeaders(upstreamResponse: Response, response: {setHeader(name: string, value: string): void;}): void {
        upstreamResponse.headers.forEach((value, name) => {
                const normalizedName = name.toLowerCase();
                if(HOP_BY_HOP_HEADERS.has(normalizedName)) {
                        return;
                }
                response.setHeader(name, value);
        });
}
