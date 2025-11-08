# BlueBubbles migration roadmap

This document tracks the BlueBubbles transport migration for AirMessage Web.
It summarizes what has already landed, what still blocks parity with the
legacy Connect workflow, and ideas worth exploring once the core experience is
solid.

## Completed work

- **BlueBubbles-first onboarding and session storage.** Contributors introduced a
  new onboarding surface that collects a BlueBubbles server URL, API password,
  and optional device label, and validates common mistakes before submitting to
  the server. The paired sign-in gate persists session credentials in secure
  storage, refreshes expiring tokens, and funnels the authenticated session into
  the existing messaging UI. 【F:src/components/Onboarding.tsx†L13-L106】【F:src/components/SignInGate.tsx†L1-L207】
- **BlueBubbles REST communications pipeline.** The connection manager now
  instantiates dedicated BlueBubbles data proxy and communications manager
  classes when BlueBubbles auth is configured. The communications manager
  handles metadata bootstrapping, chat and thread retrieval, message send and
  attachment uploads over the REST API, and reconciles tapbacks delivered via
  private API polling. 【F:src/connection/connectionManager.ts†L64-L110】【F:src/connection/connectionManager.ts†L492-L509】【F:src/connection/bluebubbles/bluebubblesCommunicationsManager.ts†L37-L210】
- **Authentication utilities.** Shared helpers normalize server URLs, surface
  certificate and private API errors, and support register/login/refresh flows
  against both the new `/api/v1/auth/*` endpoints and legacy fallbacks. 【F:src/util/bluebubblesAuth.ts†L1-L119】【F:src/util/bluebubblesAuth.ts†L123-L197】

## Outstanding integration gaps

- **Live updates.** The current BlueBubbles transport polls the REST API every
  five seconds for new messages because there is no push channel yet. We still
  need to evaluate socket or server-sent event options so message updates arrive
  instantly and polling intervals can be relaxed. 【F:src/connection/bluebubbles/bluebubblesCommunicationsManager.ts†L30-L117】【F:src/connection/bluebubbles/bluebubblesCommunicationsManager.ts†L218-L276】
- **People data and contact permissions.** When running under BlueBubbles
  authentication the app disables the contact sync prompt and falls back to a
  “reconfigure” flow. We should design a BlueBubbles-compatible people data
  story or hide people-centric UI affordances. 【F:src/components/messaging/master/Messaging.tsx†L60-L89】
- **Conversation bootstrap for ad-hoc chats.** Creating a new chat caches the
  resolved GUID locally, but the transport currently cannot resolve an unlinked
  conversation without that cache entry. Improving lookup logic or exposing a
  helper endpoint will unblock more seamless compose experiences. 【F:src/connection/bluebubbles/bluebubblesCommunicationsManager.ts†L300-L362】
- **Retrieval APIs parity.** Time/ID-based history retrieval hooks are stubbed
  out because the REST API lacks equivalent endpoints. Aligning with BlueBubbles
  capabilities or updating the backend would let us reuse the legacy fetch
  pathways for advanced history recovery. 【F:src/connection/bluebubbles/bluebubblesCommunicationsManager.ts†L184-L215】

## Future enhancements

These items are not prerequisites for launch but will improve parity and user
experience.

- **Search across message history.** The BlueBubbles API already exposes a
  flexible message query endpoint. Wiring that into the global search UI would
  restore message lookup for migrated users. 【F:src/connection/bluebubbles/api.ts†L89-L140】
- **Typing indicators and presence.** Server metadata advertises optional typing
  indicator support, but the client does not yet subscribe to or render those
  events. Investigating how BlueBubbles signals typing state would let us expose
  presence cues again. 【F:src/connection/bluebubbles/types.ts†L1-L45】
- **Richer delivery state feedback.** The transport already checks whether the
  server’s private API and read/delivered receipt features are enabled. Surfacing
  that state in the UI—and gracefully degrading when unavailable—will improve
  trust in the migration. 【F:src/connection/bluebubbles/bluebubblesCommunicationsManager.ts†L117-L160】
- **Attachment lifecycle polish.** Upload flows now emit updates when the REST
  API returns the created message, but we still rely on polling to backfill
  metadata and tapbacks. Tightening the attachment progress UX and caching
  server-provided metadata will smooth the experience. 【F:src/connection/bluebubbles/bluebubblesCommunicationsManager.ts†L210-L360】

## How to contribute

Pick an outstanding item above, open an issue or PR, and drop a note in the new
PR template so others know the migration area you touched. If you are starting a
larger feature (live updates, search, typing), please propose an implementation
outline in an issue first so the community can coordinate backend changes.
