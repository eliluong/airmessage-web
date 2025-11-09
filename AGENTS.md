# AirMessage Web – contributor guidance

This repository hosts the TypeScript/React front-end for AirMessage Web with the in-progress migration toward the BlueBubbles REST transport. The notes below summarize the structure, critical modules, and conventions to help future Codex contributors ramp up quickly.

## Project layout
- **`src/index.tsx`** – Application entry point that wires global providers (theme, localization, router) and mounts the root `App` component.
- **`src/components/`** – React components. Key surfaces include:
  - `Onboarding.tsx` and `SignInGate.tsx` – Collect BlueBubbles credentials, validate them, and bootstrap authenticated sessions.
  - `messaging/` – Conversation list and thread views. `Messaging.tsx` bridges UI state to the `conversationState` store and connection events.
  - `dialogs/`, `shared/`, etc. – Reusable UI building blocks that lean on Material UI (`@mui/material`) and the `@emotion` styling layer.
- **`src/state/`** – Client-side stores and hooks.
  - `conversationState.ts` exposes a global event-driven store (via `CachedEventEmitter`) that tracks conversations, messages, and pending operations.
  - `localMessageCache.ts` mirrors message payloads locally for optimistic updates.
  - `useMessageSearch.ts` wraps the connection layer’s search APIs and normalizes error handling.
- **`src/connection/`** – Transport abstraction. Important files:
  - `connectionManager.ts` orchestrates connection lifecycle, request routing, and background polling. It dispatches events to `conversationState` and translates errors to `stateCodes` enums.
  - `communicationsManager.ts` defines the transport interface implemented by Comm5 (legacy AirMessage Connect) and BlueBubbles.
  - `bluebubbles/` contains the REST implementation (`bluebubblesCommunicationsManager.ts`, `api.ts`, `types.ts`, `session.ts`, `bluebubblesDataProxy.ts`). These modules handle authentication, REST requests, attachment transfer, polling, and tapback reconciliation.
  - `messageSearch.ts` describes shared search option/result types used by both transports.
- **`src/data/`** – Domain model classes and serialization helpers for conversations, messages, attachments, and queued operations. Look here when you need to extend payloads flowing through the state stores.
- **`src/util/`** – Miscellaneous helpers including BlueBubbles auth utilities (`bluebubblesAuth.ts`), logging, and cross-cutting functions such as promise timeouts and encryption helpers.
- **`public/`** – Static assets bundled by Webpack.
- **`project.md`** – Living migration roadmap that documents completed BlueBubbles work, open gaps, and suggested next steps. Consult/update this when planning features.

### Path aliases
TypeScript paths map `shared/*` to `src/*` and `platform-components/*` to `browser/*` (see `tsconfig.json`). Code migrated from the legacy Electron app may still import from `shared/...`; keep new modules consistent with the preferred import path in their context.

## Data & control flow
1. Credentials are collected through the onboarding components and handed to `setBlueBubblesAuth` in `connectionManager.ts`. This swaps in the BlueBubbles data proxy and spins up the REST communications manager.
2. `BlueBubblesCommunicationsManager` bootstraps chats/messages via `api.ts`, keeps metadata fresh by polling `/server/*` and `/message/*` endpoints, and pushes updates into the shared stores.
3. UI components subscribe to `conversationState` and `peopleState` via hooks/selectors. Mutations flow back through `connectionManager` methods (send message, create chat, download attachment, etc.).
4. Search requests call `ConnectionManager.searchMessages`, which delegates to the active transport (`messageSearch.ts` types keep the signature consistent).

Whenever you add behavior in one layer, ensure the corresponding store or UI subscriber responds appropriately (e.g., emit the right events in `conversationState` when you introduce a new action in the communications manager).

## Coding conventions
- Use modern React with functional components and hooks (`useMemo`, `useCallback`, `useEffect`) to avoid unnecessary renders. Respect existing dependency arrays and exhaustive-deps linting.
- Follow existing TypeScript strictness: prefer explicit types, discriminate error shapes with tagged unions/enums from `src/data/stateCodes.ts`, and avoid `any` unless interfacing with third-party libraries.
- Error surfaces should provide human-readable messages (see `stateCodes` and existing UI alerts for tone/wording).
- Shared utilities live in `src/util` (or `shared/util` via the path alias). Reuse helpers such as `promiseTimeout`, `ResolveablePromiseTimeout`, and encryption/storage utilities before adding new abstractions.
- Keep side effects that touch the connection layer centralized in `connectionManager` or the active communications manager. UI components should call exposed methods rather than performing fetches directly.
- When modifying REST calls, study `api.ts` for authorization header handling, legacy password fallbacks, and error wrapping (`BlueBubblesApiError`). Prefer augmenting these helpers instead of duplicating fetch logic.

## Testing & validation
- Run unit tests with `npm test` (Jest). Front-end-only changes should still compile with `npm run build`.
- For manual validation against a BlueBubbles server, reference the API documentation at https://documenter.getpostman.com/view/765844/UV5RnfwM and the roadmap in `project.md` for expected behavior.
- If you add or update significant UI, include screenshots via the provided browser tooling.

## Documentation expectations
- Update `project.md` when you complete or start roadmap items related to the BlueBubbles migration.
- Document new utilities or state transitions inline with concise comments; complex flows (e.g., auth handshakes, polling intervals) benefit from high-level docstrings near the orchestrating functions.

This guidance applies to the entire repository unless a subdirectory introduces its own `AGENTS.md` with more specific rules.
