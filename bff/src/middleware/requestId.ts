import {randomUUID} from "node:crypto";
import {Request, Response, NextFunction} from "express";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
        const rawHeader = req.header("x-request-id");
        const requestId = normalizeHeaderRequestId(rawHeader) ?? randomUUID();

        res.locals.requestId = requestId;
        res.setHeader("x-request-id", requestId);
        next();
}

function normalizeHeaderRequestId(value: string | undefined): string | undefined {
        if(!value) return undefined;
        const normalized = value.trim();
        if(normalized.length === 0) return undefined;
        return normalized.slice(0, 128);
}
