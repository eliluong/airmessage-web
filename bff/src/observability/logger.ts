import pino, {DestinationStream} from "pino";

export const LOGGER_REDACTION_PATHS = [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body.password",
        "req.body.accessToken",
        "req.body.token",
        "req.query.password",
        "req.query.guid",
        "query.password",
        "query.guid",
        "res.headers[\"set-cookie\"]",
        "password",
        "guid",
        "*.password",
        "*.guid",
        "*.authorization",
        "*.cookie"
];

export function createLogger(destination?: DestinationStream): pino.Logger {
        return pino({
                level: process.env.BFF_LOG_LEVEL ?? "info",
                redact: {
                        paths: LOGGER_REDACTION_PATHS,
                        censor: "[REDACTED]"
                }
        }, destination);
}

export const logger = createLogger();
