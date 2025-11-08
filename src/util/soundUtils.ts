import soundNotification from "shared/resources/audio/notification.wav";
import soundMessageIn from "shared/resources/audio/message_in.wav";
import soundMessageOut from "shared/resources/audio/message_out.wav";
import soundTapback from "shared/resources/audio/tapback.wav";

type PlayableSound = {
  readonly file: string;
  readonly label: string;
};

const SOUND_NOTIFICATION: PlayableSound = {
  file: soundNotification,
  label: "notification",
};

const SOUND_MESSAGE_IN: PlayableSound = {
  file: soundMessageIn,
  label: "incoming message",
};

const SOUND_MESSAGE_OUT: PlayableSound = {
  file: soundMessageOut,
  label: "outgoing message",
};

const SOUND_TAPBACK: PlayableSound = {
  file: soundTapback,
  label: "tapback",
};

let hasUserActivatedAudio = false;
let activationListenersRegistered = false;

function updateUserActivationState() {
  if (typeof navigator === "undefined") {
    return;
  }

  const userActivation = (navigator as Navigator & {
    userActivation?: {hasBeenActive: boolean};
  }).userActivation;

  if (userActivation?.hasBeenActive) {
    hasUserActivatedAudio = true;
  }
}

function registerActivationListeners() {
  if (activationListenersRegistered || typeof window === "undefined") {
    return;
  }

  activationListenersRegistered = true;

  const activate = () => {
    hasUserActivatedAudio = true;
    activationListenersRegistered = false;
    window.removeEventListener("pointerdown", activate);
    window.removeEventListener("keydown", activate);
    window.removeEventListener("touchstart", activate);
    window.removeEventListener("visibilitychange", handleVisibilityChange);
  };

  const handleVisibilityChange = () => {
    if (typeof document === "undefined") {
      return;
    }

    if (document.visibilityState === "visible") {
      updateUserActivationState();
      if (hasUserActivatedAudio) {
        activate();
      }
    }
  };

  window.addEventListener("pointerdown", activate, {once: true});
  window.addEventListener("keydown", activate, {once: true});
  window.addEventListener("touchstart", activate, {once: true});
  window.addEventListener("visibilitychange", handleVisibilityChange);
}

function logPlaybackFailure(label: string, reason: unknown) {
  console.log(`Failed to play ${label} audio: ${reason}`);
}

function playSound({file, label}: PlayableSound) {
  if (typeof window === "undefined") {
    return;
  }

  updateUserActivationState();

  if (!hasUserActivatedAudio && activationListenersRegistered) {
    return;
  }

  const audio = new Audio(file);
  const playPromise = audio.play();

  if (!playPromise) {
    return;
  }

  playPromise
    .then(() => {
      hasUserActivatedAudio = true;
    })
    .catch((reason: unknown) => {
      if (!isNotAllowedError(reason)) {
        logPlaybackFailure(label, reason);
        return;
      }

      if (hasUserActivatedAudio) {
        logPlaybackFailure(label, reason);
        return;
      }

      if (!activationListenersRegistered) {
        registerActivationListeners();
        logPlaybackFailure(label, reason);
      }
    });
}

function isNotAllowedError(reason: unknown): boolean {
  if (reason instanceof DOMException) {
    return reason.name === "NotAllowedError";
  }

  if (typeof reason === "object" && reason !== null) {
    const name = (reason as {name?: unknown}).name;
    return typeof name === "string" && name === "NotAllowedError";
  }

  return false;
}

/**
 * Plays the audio sound for an incoming notification
 */
export function playSoundNotification() {
  playSound(SOUND_NOTIFICATION);
}

/**
 * Plays the audio sound for an incoming message
 */
export function playSoundMessageIn() {
  playSound(SOUND_MESSAGE_IN);
}

/**
 * Plays the audio sound for an outgoing message
 */
export function playSoundMessageOut() {
  playSound(SOUND_MESSAGE_OUT);
}

/**
 * Plays the audio sound for a new tapback
 */
export function playSoundTapback() {
  playSound(SOUND_TAPBACK);
}
