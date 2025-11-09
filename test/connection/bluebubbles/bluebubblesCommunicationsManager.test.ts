import {MessageModifierType, TapbackType} from "../../../src/data/stateCodes";
import type {MessageResponse} from "../../../src/connection/bluebubbles/types";
import {__testables} from "../../../src/connection/bluebubbles/bluebubblesCommunicationsManager";

describe("mapTapback", () => {
        const {mapTapback} = __testables;
        let warnSpy: jest.SpyInstance;

        beforeEach(() => {
                warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        });

        afterEach(() => {
                warnSpy.mockRestore();
        });

        const createMessage = (associatedMessageType: string, overrides: Partial<MessageResponse> = {}): MessageResponse => ({
                originalROWID: 1,
                guid: "reaction-guid",
                text: "",
                handleId: 2,
                otherHandle: 0,
                subject: "",
                error: 0,
                dateCreated: 0,
                dateRead: null,
                dateDelivered: null,
                isFromMe: false,
                isArchived: false,
                itemType: 0,
                groupTitle: null,
                groupActionType: 0,
                balloonBundleId: null,
                associatedMessageGuid: "target-guid",
                associatedMessageType,
                expressiveSendStyleId: null,
                handle: {
                        originalROWID: 3,
                        address: "friend@example.com",
                        service: "iMessage"
                },
                ...overrides
        } as MessageResponse);

        it.each([
                {
                        name: "love addition string identifier",
                        identifier: "love",
                        expectedType: TapbackType.Love,
                        isAddition: true
                },
                {
                        name: "emphasize addition string identifier (case insensitive)",
                        identifier: "EMPHASIZE",
                        expectedType: TapbackType.Emphasis,
                        isAddition: true
                },
                {
                        name: "laugh removal string identifier",
                        identifier: "-laugh",
                        expectedType: TapbackType.Laugh,
                        isAddition: false,
                        overrides: {isFromMe: true}
                }
        ])("normalizes $name", ({identifier, expectedType, isAddition, overrides}) => {
                const tapback = mapTapback(createMessage(identifier, overrides));
                expect(tapback).toBeDefined();
                expect(tapback).toEqual(
                        expect.objectContaining({
                                tapbackType: expectedType,
                                isAddition,
                                type: MessageModifierType.Tapback,
                                messageGuid: "target-guid",
                                messageIndex: 0
                        })
                );

                const expectedSender = overrides?.isFromMe ? "me" : "friend@example.com";
                expect(tapback?.sender).toBe(expectedSender);
                expect(warnSpy).not.toHaveBeenCalled();
        });
});
