import React from "react";
import {cleanup, fireEvent, render} from "@testing-library/react";
import Messaging from "shared/components/messaging/master/Messaging";
import {clearFaviconBadge, initializeFaviconBadge} from "shared/util/faviconBadge";

const mockMessageActionEmitter = {
        subscribe: jest.fn(),
        unsubscribe: jest.fn()
};

const mockChatActivationEmitter = {
        subscribe: jest.fn(),
        unsubscribe: jest.fn()
};

const mockSetBlueBubblesAuth = jest.fn();
const mockDisconnect = jest.fn();
const mockAddConnectionListener = jest.fn();
const mockRemoveConnectionListener = jest.fn();
const mockConnect = jest.fn();
const mockRequestMissedMessages = jest.fn();
const mockIsDisconnected = jest.fn(() => false);
const mockIsConnected = jest.fn(() => false);
const mockSearchCacheClear = jest.fn();

let mockVisibilityState: DocumentVisibilityState = "visible";
let mockDocumentHasFocus = false;

jest.mock("shared/components/messaging/master/Sidebar", () => ({
        __esModule: true,
        default: () => null
}));

jest.mock("shared/components/control/SnackbarProvider", () => ({
        __esModule: true,
        default: (props: {children?: React.ReactNode}) => <>{props.children}</>
}));

jest.mock("shared/components/messaging/create/DetailCreate", () => ({
        __esModule: true,
        default: () => null
}));

jest.mock("shared/components/messaging/detail/DetailLoading", () => ({
        __esModule: true,
        default: () => null
}));

jest.mock("shared/components/messaging/detail/DetailError", () => ({
        __esModule: true,
        default: () => null
}));

jest.mock("shared/components/messaging/detail/DetailWelcome", () => ({
        __esModule: true,
        default: () => null
}));

jest.mock("shared/components/messaging/thread/DetailThread", () => ({
        __esModule: true,
        default: () => null
}));

jest.mock("shared/components/calling/CallOverlay", () => ({
        __esModule: true,
        default: () => null
}));

jest.mock("shared/state/conversationState", () => ({
        __esModule: true,
        default: () => ({
                conversations: undefined,
                visibleConversations: undefined,
                hasMoreConversations: false,
                loadConversations: jest.fn().mockResolvedValue([]),
                loadMoreConversations: jest.fn().mockResolvedValue([]),
                addConversation: jest.fn(),
                markConversationRead: jest.fn()
        })
}));

jest.mock("shared/interface/notification/notificationUtils", () => ({
        getNotificationUtils: () => ({
                initialize: jest.fn(),
                getMessageActionEmitter: () => mockMessageActionEmitter,
                showMessageNotifications: jest.fn()
        })
}));

jest.mock("shared/interface/platform/platformUtils", () => ({
        getPlatformUtils: () => ({
                initializeActivations: jest.fn(),
                getChatActivationEmitter: () => mockChatActivationEmitter
        })
}));

jest.mock("shared/connection/connectionManager", () => ({
        __esModule: true,
        setBlueBubblesAuth: (...args: unknown[]) => mockSetBlueBubblesAuth(...args),
        disconnect: (...args: unknown[]) => mockDisconnect(...args),
        addConnectionListener: (...args: unknown[]) => mockAddConnectionListener(...args),
        removeConnectionListener: (...args: unknown[]) => mockRemoveConnectionListener(...args),
        connect: (...args: unknown[]) => mockConnect(...args),
        requestMissedMessages: (...args: unknown[]) => mockRequestMissedMessages(...args),
        isDisconnected: () => mockIsDisconnected(),
        isConnected: () => mockIsConnected()
}));

jest.mock("shared/state/searchCache", () => ({
        searchCache: {
                clear: (...args: unknown[]) => mockSearchCacheClear(...args)
        }
}));

jest.mock("shared/connection/bluebubbles/debugLogging", () => ({
        logSelectedConversationPayload: jest.fn()
}));

jest.mock("shared/util/faviconBadge", () => ({
        initializeFaviconBadge: jest.fn(),
        clearFaviconBadge: jest.fn(),
        setFaviconBadgeVisible: jest.fn()
}));

describe("Messaging favicon badge lifecycle", () => {
        beforeEach(() => {
                jest.clearAllMocks();

                mockVisibilityState = "visible";
                mockDocumentHasFocus = false;

                Object.defineProperty(document, "visibilityState", {
                        configurable: true,
                        get: () => mockVisibilityState
                });

                jest.spyOn(document, "hasFocus").mockImplementation(() => mockDocumentHasFocus);
        });

        afterEach(() => {
                cleanup();
                jest.restoreAllMocks();
        });

        it("initializes on mount and clears when tab returns to active state", () => {
                const mockedInitializeFaviconBadge = initializeFaviconBadge as jest.Mock;
                const mockedClearFaviconBadge = clearFaviconBadge as jest.Mock;

                const {unmount} = render(
                        <Messaging
                                serverUrl="https://example.com"
                                accessToken="token"
                                transportMode="bff"
                        />
                );

                expect(mockedInitializeFaviconBadge).toHaveBeenCalledTimes(1);

                mockVisibilityState = "hidden";
                mockDocumentHasFocus = false;
                fireEvent(document, new Event("visibilitychange"));
                expect(mockedClearFaviconBadge).toHaveBeenCalledTimes(0);

                mockVisibilityState = "visible";
                mockDocumentHasFocus = false;
                fireEvent(document, new Event("visibilitychange"));
                expect(mockedClearFaviconBadge).toHaveBeenCalledTimes(1);

                mockVisibilityState = "hidden";
                mockDocumentHasFocus = true;
                fireEvent(window, new Event("focus"));
                expect(mockedClearFaviconBadge).toHaveBeenCalledTimes(2);

                unmount();
                expect(mockedClearFaviconBadge).toHaveBeenCalledTimes(3);
        });
});
