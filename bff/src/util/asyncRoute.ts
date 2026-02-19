import {RequestHandler} from "express";

export function asyncRoute(handler: RequestHandler): RequestHandler {
        return (req, res, next) => {
                Promise.resolve(handler(req, res, next)).catch(next);
        };
}
