import soundNotification from "shared/resources/audio/notification.wav";
import soundMessageIn from "shared/resources/audio/message_in.wav";
import soundMessageOut from "shared/resources/audio/message_out.wav";
import soundTapback from "shared/resources/audio/tapback.wav";
import {logBlueBubblesDebug} from "shared/connection/bluebubbles/debugLogging";
import type {MessageItem, MessageModifier} from "shared/data/blocks";

export type SoundPlaybackContext = {
        type: "messageIn" | "messageOut" | "notification" | "tapback";
        conversationId?: string;
        conversationLocalId?: number;
        conversationTitle?: string;
        message?: MessageItem;
        messages?: MessageItem[];
        modifiers?: MessageModifier[];
        notificationConversations?: Array<{conversationId: string; messages: MessageItem[]}>;
};

function playAudioWithLogging(
        source: string,
        label: string,
        failureLabel: string,
        context?: SoundPlaybackContext
) {
        logBlueBubblesDebug(`Playing ${label} sound`, context);
        new Audio(source).play()?.catch((reason) => {
                console.log(`Failed to play ${failureLabel} audio: ` + reason);
        });
}

/**
 * Plays the audio sound for an incoming notification
 */
export function playSoundNotification(context?: SoundPlaybackContext) {
        playAudioWithLogging(soundNotification, "notification", "notification", context);
}

/**
 * Plays the audio sound for an incoming message
 */
export function playSoundMessageIn(context?: SoundPlaybackContext) {
        playAudioWithLogging(soundMessageIn, "incoming message", "incoming message", context);
}

/**
 * Plays the audio sound for an outgoing message
 */
export function playSoundMessageOut(context?: SoundPlaybackContext) {
        playAudioWithLogging(soundMessageOut, "outgoing message", "outgoing message", context);
}

/**
 * Plays the audio sound for a new tapback
 */
export function playSoundTapback(context?: SoundPlaybackContext) {
        playAudioWithLogging(soundTapback, "tapback", "tapback", context);
}