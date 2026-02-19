import {NextFunction, Request, Response} from "express";
import {BffHttpError, buildErrorBody, getErrorMessage} from "../errors";
import {logger} from "../observability/logger";

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
        next(new BffHttpError({
                code: "BFF_ROUTE_NOT_FOUND",
                status: 404,
                message: "Route not found."
        }));
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
        const requestId = typeof res.locals.requestId === "string" ? res.locals.requestId : undefined;
        const normalizedError = normalizeError(error);

        logger.error({
                requestId,
                method: req.method,
                path: req.path,
                status: normalizedError.status,
                code: normalizedError.code,
                message: normalizedError.message,
                details: normalizedError.details
        }, "Request failed");

        res
                .status(normalizedError.status)
                .json(buildErrorBody(normalizedError, requestId));
}

function normalizeError(error: unknown): BffHttpError {
        if(error instanceof BffHttpError) {
                return error;
        }

        return new BffHttpError({
                code: "BFF_INTERNAL_ERROR",
                status: 500,
                message: getErrorMessage(error),
                retriable: false
        });
}
