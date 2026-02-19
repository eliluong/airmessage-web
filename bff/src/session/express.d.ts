import "express-session";
import {BffSessionRecord} from "./types";

declare module "express-session" {
        interface SessionData {
                bffSession?: BffSessionRecord;
        }
}
