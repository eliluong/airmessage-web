import {ConnectionErrorCode, MessageErrorCode} from "../../src/data/stateCodes";

type ConnectionManagerModule = typeof import("../../src/connection/connectionManager");

interface MockManagerInstance {
        listener?: {
                onOpen?: (...args: unknown[]) => void;
                onConversationUpdate?: (...args: unknown[]) => void;
                onMessageThread?: (...args: unknown[]) => void;
                [key: string]: unknown;
        };
}

async function flushMicrotasks() {
        await Promise.resolve();
        await Promise.resolve();
}

async function loadConnectionManagerWithMocks() {
        const managerInstances: MockManagerInstance[] = [];

        jest.doMock("../../src/connection/bluebubbles/bluebubblesDataProxy", () => ({
                __esModule: true,
                default: class MockBlueBubblesDataProxy {
                        public readonly proxyType = "BlueBubbles";
                        public listener: unknown;
                        public start(): void {/* no-op */}
                        public stop(): void {/* no-op */}
                        public stopWithReason(): void {/* no-op */}
                        public send(): void {/* no-op */}
                }
        }));

        jest.doMock("../../src/connection/bluebubbles/bluebubblesCommunicationsManager", () => ({
                __esModule: true,
                default: class MockBlueBubblesCommunicationsManager {
                        public listener: MockManagerInstance["listener"];

                        constructor() {
                                this.listener = undefined;
                                managerInstances.push(this);
                        }

                        public connect(): void {/* no-op */}
                        public disconnect(): void {/* no-op */}
                        public sendPing(): boolean { return true; }
                        public requestLiteConversations(): boolean { return true; }
                        public requestConversationInfo(): boolean { return true; }
                        public requestLiteThread(): boolean { return true; }
                        public sendMessage(): boolean { return true; }
                        public sendFile(): Promise<string> { return Promise.resolve("file-guid"); }
                        public requestAttachmentDownload(): boolean { return true; }
                        public requestRetrievalTime(): boolean { return true; }
                        public requestRetrievalID(): boolean { return true; }
                        public requestChatCreation(): boolean { return true; }
                        public requestInstallRemoteUpdate(): boolean { return true; }
                        public requestFaceTimeLink(): boolean { return true; }
                        public initiateFaceTimeCall(): boolean { return true; }
                        public handleIncomingFaceTimeCall(): boolean { return true; }
                        public dropFaceTimeCallServer(): boolean { return true; }
                }
        }));

        jest.doMock("../../src/connection/comm5/clientComm5", () => ({
                __esModule: true,
                default: class MockClientComm5 {
                        public listener: MockManagerInstance["listener"];

                        constructor() {
                                this.listener = undefined;
                        }

                        public connect(): void {/* no-op */}
                        public disconnect(): void {/* no-op */}
                        public sendPing(): boolean { return true; }
                        public requestLiteConversations(): boolean { return true; }
                        public requestConversationInfo(): boolean { return true; }
                        public requestLiteThread(): boolean { return true; }
                        public sendMessage(): boolean { return true; }
                        public sendFile(): Promise<string> { return Promise.resolve("file-guid"); }
                        public requestAttachmentDownload(): boolean { return true; }
                        public requestRetrievalTime(): boolean { return true; }
                        public requestRetrievalID(): boolean { return true; }
                        public requestChatCreation(): boolean { return true; }
                        public requestInstallRemoteUpdate(): boolean { return true; }
                        public requestFaceTimeLink(): boolean { return true; }
                        public initiateFaceTimeCall(): boolean { return true; }
                        public handleIncomingFaceTimeCall(): boolean { return true; }
                        public dropFaceTimeCallServer(): boolean { return true; }
                }
        }));

        jest.doMock("shared/util/encryptionUtils", () => ({
                isCryptoPasswordSet: () => true,
                setCryptoPassword: async () => undefined
        }));

        jest.doMock("shared/util/secureStorageUtils", () => ({
                getSecureLS: async () => undefined,
                setSecureLS: async () => undefined,
                SecureStorageKey: {
                        ServerPassword: "ServerPassword"
                }
        }));

        const connectionManager: ConnectionManagerModule = await import("../../src/connection/connectionManager");
        return {connectionManager, managerInstances};
}

describe("connectionManager reconnect lifecycle", () => {
        beforeEach(() => {
                jest.resetModules();
                jest.clearAllMocks();
        });

        afterEach(() => {
                jest.useRealTimers();
        });

        it("ignores stale manager callbacks after reconnect replacement", async () => {
                const {connectionManager, managerInstances} = await loadConnectionManagerWithMocks();
                connectionManager.setBlueBubblesAuth({
                        serverUrl: "https://example.test",
                        accessToken: "token"
                });

                const listener = {
                        onConnecting: jest.fn(),
                        onOpen: jest.fn(),
                        onClose: jest.fn()
                };
                connectionManager.addConnectionListener(listener);

                await connectionManager.connect();
                expect(managerInstances).toHaveLength(1);
                const staleScopedListener = managerInstances[0].listener;
                expect(staleScopedListener).toBeDefined();

                await connectionManager.connect();
                expect(managerInstances).toHaveLength(2);
                expect(managerInstances[0].listener).toBeUndefined();

                staleScopedListener?.onOpen?.("stale-device", "stale-os", "stale-version", false);
                expect(listener.onOpen).toHaveBeenCalledTimes(0);

                managerInstances[1].listener?.onOpen?.("active-device", "active-os", "active-version", false);
                expect(listener.onOpen).toHaveBeenCalledTimes(1);

                connectionManager.removeConnectionListener(listener);
        });

        it("uses an extended timeout window for initial conversation bootstrap", async () => {
                jest.useFakeTimers();
                const {connectionManager, managerInstances} = await loadConnectionManagerWithMocks();
                connectionManager.setBlueBubblesAuth({
                        serverUrl: "https://example.test",
                        accessToken: "token"
                });

                const listener = {
                        onConnecting: jest.fn(),
                        onOpen: jest.fn(),
                        onClose: jest.fn()
                };
                connectionManager.addConnectionListener(listener);

                await connectionManager.connect();
                managerInstances[0].listener?.onOpen?.("device", "os", "version", false);

                let settled = false;
                const conversationsPromise = connectionManager.fetchConversations().catch((error) => {
                        settled = true;
                        throw error;
                });
                conversationsPromise.then(() => {
                        settled = true;
                }).catch(() => undefined);

                jest.advanceTimersByTime(30_000);
                await flushMicrotasks();
                expect(settled).toBe(false);

                jest.advanceTimersByTime(30_000);
                await flushMicrotasks();
                await expect(conversationsPromise).rejects.toEqual({code: MessageErrorCode.LocalNetwork});

                connectionManager.removeConnectionListener(listener);
        });

        it("cleans conversation info promise queues after successful updates", async () => {
                const {connectionManager, managerInstances} = await loadConnectionManagerWithMocks();
                connectionManager.setBlueBubblesAuth({
                        serverUrl: "https://example.test",
                        accessToken: "token"
                });

                await connectionManager.connect();
                managerInstances[0].listener?.onOpen?.("device", "os", "version", false);

                const conversationKey = ["chat-cleanup"];
                const response: [string, undefined][] = [[conversationKey[0], undefined]];

                const firstPromise = connectionManager.fetchConversationInfo(conversationKey);
                expect(connectionManager.__testables.getConversationDetailsQueueSize(conversationKey)).toBe(1);

                managerInstances[0].listener?.onConversationUpdate?.(response);
                await expect(firstPromise).resolves.toEqual(response);
                expect(connectionManager.__testables.getConversationDetailsQueueSize(conversationKey)).toBe(0);

                const secondPromise = connectionManager.fetchConversationInfo(conversationKey);
                expect(connectionManager.__testables.getConversationDetailsQueueSize(conversationKey)).toBe(1);

                managerInstances[0].listener?.onConversationUpdate?.(response);
                await expect(secondPromise).resolves.toEqual(response);
                expect(connectionManager.__testables.getConversationDetailsQueueSize(conversationKey)).toBe(0);
        });

        it("cleans conversation info promise queues on timeout failures", async () => {
                jest.useFakeTimers();
                const {connectionManager, managerInstances} = await loadConnectionManagerWithMocks();
                connectionManager.setBlueBubblesAuth({
                        serverUrl: "https://example.test",
                        accessToken: "token"
                });

                await connectionManager.connect();
                managerInstances[0].listener?.onOpen?.("device", "os", "version", false);

                const conversationKey = ["chat-timeout"];
                const pendingPromise = connectionManager.fetchConversationInfo(conversationKey);
                expect(connectionManager.__testables.getConversationDetailsQueueSize(conversationKey)).toBe(1);

                jest.advanceTimersByTime(10_000);
                await flushMicrotasks();
                await expect(pendingPromise).rejects.toEqual({code: MessageErrorCode.LocalNetwork});
                expect(connectionManager.__testables.getConversationDetailsQueueSize(conversationKey)).toBe(0);
        });

        it("preserves thread promise cleanup semantics", async () => {
                const {connectionManager, managerInstances} = await loadConnectionManagerWithMocks();
                connectionManager.setBlueBubblesAuth({
                        serverUrl: "https://example.test",
                        accessToken: "token"
                });

                await connectionManager.connect();
                managerInstances[0].listener?.onOpen?.("device", "os", "version", false);

                const threadPromise = connectionManager.fetchThread("chat-thread");
                expect(connectionManager.__testables.getThreadQueueSize("chat-thread")).toBe(1);

                managerInstances[0].listener?.onMessageThread?.("chat-thread", undefined, [], undefined);
                await expect(threadPromise).resolves.toEqual({items: [], metadata: undefined});
                expect(connectionManager.__testables.getThreadQueueSize("chat-thread")).toBe(0);
        });
});
