export interface BffErrorBody {
        error: {
                code: string;
                message: string;
                requestId?: string;
                status?: number;
                retriable?: boolean;
        };
}

export class BffHttpError extends Error {
        public readonly code: string;
        public readonly status: number;
        public readonly retriable: boolean;
        public readonly details: unknown;

        constructor(options: {
                code: string;
                status: number;
                message: string;
                retriable?: boolean;
                details?: unknown;
        }) {
                super(options.message);
                this.name = "BffHttpError";
                this.code = options.code;
                this.status = options.status;
                this.retriable = options.retriable ?? false;
                this.details = options.details;
        }
}

export function getErrorMessage(error: unknown): string {
        if(error instanceof Error) return error.message;
        if(typeof error === "string") return error;
        if(error === null || error === undefined) return "Unknown error";

        try {
                return JSON.stringify(error);
        } catch {
                return String(error);
        }
}

export function buildErrorBody(error: BffHttpError, requestId?: string): BffErrorBody {
        return {
                error: {
                        code: error.code,
                        message: error.message,
                        requestId,
                        status: error.status,
                        retriable: error.retriable
                }
        };
}
