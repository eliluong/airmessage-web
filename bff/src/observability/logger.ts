import pino from "pino";

export const logger = pino({
        level: process.env.BFF_LOG_LEVEL ?? "info",
        redact: {
                paths: [
                        "req.headers.authorization",
                        "req.headers.cookie",
                        "req.body.password",
                        "req.body.accessToken",
                        "req.body.token",
                        "res.headers[\"set-cookie\"]",
                        "password",
                        "guid",
                        "*.password",
                        "*.guid",
                        "*.authorization",
                        "*.cookie"
                ],
                censor: "[REDACTED]"
        }
});
