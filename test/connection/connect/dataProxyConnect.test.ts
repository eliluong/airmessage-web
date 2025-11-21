import {TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder} from "util";

(globalThis as unknown as {TextDecoder: typeof NodeTextDecoder}).TextDecoder = NodeTextDecoder;
(globalThis as unknown as {TextEncoder: typeof NodeTextEncoder}).TextEncoder = NodeTextEncoder;

jest.mock("shared/connection/connectionManager", () => ({
        getBlueBubblesAuth: jest.fn()
}));

const {buildWebSocketURL} = require("../../../src/connection/connect/dataProxyConnect") as typeof import("../../../src/connection/connect/dataProxyConnect");

describe("buildWebSocketURL", () => {
        test("https server URLs drop insecure ports", () => {
                const url = buildWebSocketURL("https://example.com:8080/", "token");
                expect(url.protocol).toBe("wss:");
                expect(url.host).toBe("example.com");
                expect(url.pathname).toBe("/api/v1/socket");
                expect(url.searchParams.get("token")).toBe("token");
        });
});
