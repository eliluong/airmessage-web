# BlueBubbles BFF Security Implementation Plan

## 1) Problem Statement

The current web client can enter `legacyPasswordAuth` mode, where requests append `password` query parameters to BlueBubbles REST calls (for example `query`, `download`, and attachment upload routes). This exposes sensitive credentials to browser-visible request surfaces and to any client-side logging/proxy tooling.

Given your environment consistently returns `404` for `/api/v1/auth/login` and `/api/v1/login`, token-only browser auth is not currently viable. The recommended solution is a Node-based Backend-for-Frontend (BFF) intermediary so browser clients never communicate with BlueBubbles directly.

## 2) Goals / Non-goals

### Goals
- Remove BlueBubbles server credentials from browser request URLs, headers, storage, and runtime state.
- Preserve current web UX and message feature parity.
- Support legacy BlueBubbles auth deployments where only password/guid-based auth is available.
- Provide a phased migration path with feature flags and rollback capability.

### Non-goals
- Replacing BlueBubbles server auth model.
- Changing AirMessage UI architecture outside transport/auth boundaries.
- Implementing every optional hardening control in phase 1.

## 3) High-level Architecture

```text
Browser (AirMessage Web)
  -> Node BFF (same-origin API + socket endpoint, session cookies)
    -> BlueBubbles Server (REST + socket)
```

Key principle: only the BFF knows BlueBubbles `password/guid/token`. The browser receives only a BFF session cookie.

## 4) Why Node BFF (vs Flask)

- Same ecosystem as this repository (TypeScript/Node/Webpack/Jest).
- Easier sharing of request/response typing patterns with existing TS code.
- Native fit for socket proxying with `socket.io` / `socket.io-client`.
- Lower coordination overhead for contributors already working in this codebase.

## 5) BFF Core Design

## 5.1 Authentication model

1. Browser submits server credentials once to BFF:
   - `POST /bff/session/login`
   - Body: `{ serverUrl, password, deviceName? }`
2. BFF validates the target and authenticates upstream:
   - Try `/api/v1/auth/login`
   - Then `/api/v1/login`
   - If both 404, probe legacy auth (`/api/v1/ping` or `/api/v1/server/info` with password/guid query)
3. BFF stores upstream credentials server-side in session state.
4. BFF returns:
   - `Set-Cookie: bff_session=...; HttpOnly; Secure; SameSite=Strict`
   - CSRF token for mutating routes (header-based double-submit token pattern).

No BlueBubbles credential material is returned to browser JS.

## 5.2 Session record schema (server-side)

```ts
type UpstreamAuthMode = "modern-token" | "legacy-guid";

interface BffSessionRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  serverUrl: string;
  deviceName?: string;
  authMode: UpstreamAuthMode;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  socketGuid?: string;
  legacyPasswordGuid?: string;
}
```

Storage:
- Phase 1 dev: in-memory store.
- Phase 2+: Redis-backed store (`connect-redis`) with TTL and idle expiration.

## 5.3 API surface exposed to browser

### Session routes
- `POST /bff/session/login`
- `GET /bff/session/status`
- `POST /bff/session/logout`

### Data proxy routes (allowlisted)
- `GET /bff/server/info`
- `GET /bff/server/features`
- `POST /bff/chat/query`
- `GET /bff/chat/count`
- `GET /bff/chat/:guid`
- `GET /bff/chat/:guid/message`
- `POST /bff/message/query`
- `POST /bff/message/text`
- `POST /bff/message/attachment`
- `GET /bff/attachment/:guid/download`
- Add more routes only as needed by current web transport.

Route mapping:
- BFF route -> corresponding BlueBubbles `/api/v1/...` route
- BFF injects upstream credentials per auth mode.

### Socket endpoint
- Browser connects to `io("/bff/socket")`.
- BFF owns upstream BlueBubbles socket connection and forwards sanitized events:
  - `new-message`
  - `updated-message`
  - others as phased additions.

## 5.4 Security controls (required baseline)

- `helmet` security headers.
- Strict CORS allowlist (ideally same-origin only).
- HttpOnly + Secure + SameSite cookies.
- CSRF validation on mutating routes.
- Request body size limits.
- Route allowlist (no open proxy behavior).
- Pino structured logging with redaction:
  - redact `password`, `guid`, `Authorization`, `Cookie`, query strings for auth params.
- Upstream URL validation:
  - only `http`/`https`
  - optional host allowlist for internal network ranges.

## 5.5 Error and failure model

- BFF returns normalized error payloads with user-safe messages.
- No silent fallback:
  - if upstream auth mode changes or becomes invalid, return explicit session-invalid responses.
- Refresh behavior:
  - for modern token mode, BFF refreshes upstream token before expiry.
  - for legacy mode, BFF keeps guid/password server-side and retries with bounded backoff.

## 6) AirMessage Web Changes

Keep existing architectural invariant: UI -> `connectionManager` -> transport.

## 6.1 Transport addition

Add a new transport path in `src/connection/bluebubbles/`:
- `bff/api.ts`: calls `/bff/*` instead of direct BlueBubbles `/api/v1/*`.
- `bff/sessionApi.ts`: handles `/bff/session/*` auth/status/logout flows.
- `bff/realtimeChannel.ts`: Phase 1 placeholder channel that keeps polling active until socket bridging lands.

`connectionManager` remains the orchestration entrypoint.

## 6.2 Sign-in flow changes

Current `Onboarding` and `SignInGate` collect BlueBubbles server URL/password and store direct auth state. Replace with:
- Submit credentials to `POST /bff/session/login`.
- Persist only BFF session metadata (or rely entirely on cookie + `session/status`).
- Remove browser persistence of BlueBubbles `accessToken`, `socketGuid`, `legacyPasswordAuth`.

## 6.3 Compatibility flag

Add feature flag:
- `WPEnv.BFF_ENABLED` (build-time) and/or runtime toggle.
- Allows controlled rollout and fallback to current direct mode during migration.

## 7) Suggested BFF Folder Structure

```text
bff/
  package.json
  tsconfig.json
  src/
    server.ts
    app.ts
    config.ts
    middleware/
      authSession.ts
      csrf.ts
      requestId.ts
      errorHandler.ts
    session/
      store.ts
      types.ts
    upstream/
      bluebubblesAuth.ts
      bluebubblesClient.ts
      bluebubblesSocket.ts
      serializers.ts
    routes/
      sessionRoutes.ts
      chatRoutes.ts
      messageRoutes.ts
      attachmentRoutes.ts
      serverRoutes.ts
    security/
      redaction.ts
      urlValidation.ts
      rateLimit.ts
    observability/
      logger.ts
      metrics.ts
  test/
    unit/
    integration/
```

## 8) Phased Implementation Plan

## Phase 0: Design freeze + contract scaffold
Status (2026-02-18): COMPLETE

- Finalize route contracts and error envelope.
- Add `BFF_ENABLED` flag in web app.
- Introduce transport abstraction hooks so direct/BFF paths are swappable.

Delivered artifacts:
- `src/connection/bluebubbles/bff/contracts.ts` defines the `/bff` route constants and normalized `BffErrorEnvelope`.
- `src/connection/bluebubbles/transport.ts` centralizes BlueBubbles API/realtime construction behind a transport-mode seam (`direct` vs `bff`).
- `WPEnv.BFF_ENABLED` is wired through `webpack.config.js`, `index.d.ts`, and `.env.example`.
- `connectionManager` and `bluebubblesCommunicationsManager` now use the transport seam instead of directly instantiating API/realtime modules.
- `SignInGate`/`Messaging`/session types now carry `transportMode` so runtime path selection is explicit.
- Guardrail: direct and BFF paths stay explicit (`transportMode`) so rollout remains feature-flag controlled.

Exit criteria:
- No behavior change in production path.
- CI green.

## Phase 1: Minimal BFF with session auth + core read APIs
Status (2026-02-19): COMPLETE

- Implement `POST /bff/session/login`, `GET /bff/session/status`, `POST /bff/session/logout`.
- Implement read-only proxy routes needed for initial app load:
  - general ping
  - server info/features
  - chat query/count/single
  - chat messages
  - message query (required for polling/thread bootstrap compatibility)
- Web client behind flag uses BFF for login + chat/thread bootstrap.

Delivered artifacts:
- Added Node BFF scaffold under `bff/` (`app.ts`, `server.ts`, `config.ts`, session typing, error middleware, request IDs, allowlisted route handlers).
- Added upstream auth/proxy modules implementing modern-login fallback and legacy-guid probe behavior server-side.
- Added Phase 1 proxy routes: `/bff/general/ping`, `/bff/server/info`, `/bff/server/features`, `/bff/chat/query`, `/bff/chat/count`, `/bff/chat/:guid`, `/bff/chat/:guid/message`, `/bff/message/query`.
- Added web-side BFF clients: `src/connection/bluebubbles/bff/api.ts`, `src/connection/bluebubbles/bff/sessionApi.ts`, `src/connection/bluebubbles/bff/realtimeChannel.ts`.
- Updated `src/connection/bluebubbles/transport.ts` to route read/bootstrap calls through BFF mode behind explicit `transportMode` control.
- Updated `src/components/SignInGate.tsx` to authenticate via `/bff/session/login`, restore via `/bff/session/status`, and persist only non-secret metadata in browser storage when in BFF mode.
- Added regression coverage for BFF web clients/channels (`test/connection/bluebubbles/bffApi.test.ts`, `test/connection/bluebubbles/bffSessionApi.test.ts`, `test/connection/bluebubbles/bffRealtimeChannel.test.ts`).

Exit criteria:
- Browser no longer calls BlueBubbles directly when flag is enabled.
- Chat list and thread open work end-to-end.

## Phase 2: Message send/search + attachment transfer
Status (2026-02-19): COMPLETE

- Add message mutation routes (`/message/text`, `/message/query`, `/message/attachment`).
- Add attachment download proxy streaming with abort support.
- Implement CSRF protections for mutating endpoints.

Delivered artifacts:
- Added BFF Phase 2 mutation/media routes: `POST /bff/message/text`, `POST /bff/message/attachment`, `GET /bff/attachment/:guid/download` with upstream proxying and attachment download abort propagation on client disconnect.
- Added CSRF token model to BFF sessions (`csrfToken`), issued via `/bff/session/login` and `/bff/session/status`, and enforced on mutating routes (`/bff/session/logout`, `/bff/message/text`, `/bff/message/attachment`).
- Extended BFF upstream client to handle JSON and raw streamed request bodies plus raw response passthrough for media download routes.
- Routed BFF-mode web send/media actions through new BFF endpoints (`sendTextMessage`, upload target resolution, attachment download/thumbnail download), removing prior Phase 1 not-implemented errors for those paths.
- Added web-side CSRF token cache + header wiring for BFF mutating calls and logout (`X-CSRF-Token`).
- Added Phase 2 regression coverage for CSRF/session and transport route usage (`test/connection/bluebubbles/bffApi.test.ts`, `test/connection/bluebubbles/bffSessionApi.test.ts`, `test/connection/bluebubbles/transport.test.ts`).

Exit criteria:
- Send text, search, upload attachment, and download attachment all work through BFF.

## Phase 3: Realtime socket bridge
Status (2026-02-19): COMPLETE

- BFF maintains upstream socket auth (`guid`/`socketGuid`) server-side.
- Browser subscribes to `/bff/socket`.
- Forward required events and ack/error handling.
- Keep health-driven fallback logic in client transport.

Delivered artifacts:
- Added BFF realtime bridge bootstrap (`bff/src/realtime/bridge.ts`, `bff/src/realtime/contracts.ts`) mounted on Socket.IO path `/bff/socket`.
- Refactored session middleware wiring so Express routes and the Socket.IO engine share the same authenticated session context (`bff/src/session/middleware.ts`, `bff/src/app.ts`, `bff/src/server.ts`).
- Removed the Phase 1 placeholder `/bff/socket` HTTP route and replaced it with session-gated Socket.IO auth middleware plus upstream bridge lifecycle handling.
- BFF now creates upstream BlueBubbles sockets from server-side session credentials, forwards `new-message`/`updated-message`, propagates browser acks when provided, and emits bridge health updates via `bff-realtime-state`.
- Replaced web Phase 1 realtime placeholder with a real BFF Socket.IO client channel (`src/connection/bluebubbles/bff/realtimeChannel.ts`) that consumes bridge health updates to preserve poll fallback behavior.
- Added/updated regression coverage for server and web realtime bridge behavior (`test/bff/realtime/bridge.test.ts`, `test/bff/upstream/realtimeSocket.test.ts`, `test/connection/bluebubbles/bffRealtimeChannel.test.ts`).

Exit criteria:
- Realtime receive path functions without direct browser socket to BlueBubbles.

## Phase 4: Hardening + production readiness
Status (2026-02-19): COMPLETE

- Redis session store and TTL controls.
- Rate limiting, host allowlist, secure deployment docs (TLS termination via reverse proxy).
- Structured metrics (auth failures, proxy latency, reconnect counts, upstream 4xx/5xx).
- Security review checklist and log redaction verification.

Delivered artifacts:
- Added configurable session persistence controls with Redis-backed `connect-redis` support, TTL wiring, and clean shutdown handling (`bff/src/config.ts`, `bff/src/session/middleware.ts`, `bff/src/server.ts`).
- Added upstream host allowlist enforcement controls (`BFF_UPSTREAM_ALLOWED_HOSTS` / `BFF_UPSTREAM_ALLOWED_CIDRS`) with wildcard/CIDR validation and runtime host rejection (`bff/src/security/urlValidation.ts`, `bff/src/upstream/auth.ts`, `bff/src/routes/sessionRoutes.ts`).
- Added configurable request rate limiting for auth and proxy paths (`bff/src/security/rateLimit.ts`, `bff/src/app.ts`).
- Added Prometheus-style metrics for auth failures, upstream latency + status/error classes, and realtime reconnect churn, exposed via `/bff/metrics` with optional bearer-token protection (`bff/src/observability/metrics.ts`, `bff/src/realtime/bridge.ts`, `bff/src/upstream/client.ts`, `bff/src/app.ts`).
- Expanded redaction coverage and added explicit verification tests (`bff/src/observability/logger.ts`, `test/bff/observability/logger.test.ts`).
- Added Phase 4 regression coverage for allowlist/rate-limit/metrics behavior (`test/bff/security/urlValidation.test.ts`, `test/bff/security/rateLimit.test.ts`, `test/bff/observability/metrics.test.ts`).
- Added deployment/security operator checklist with TLS/reverse-proxy guidance and hardening verification steps (`bff/SECURITY_CHECKLIST.md`, `bff/.env.example`).

Exit criteria:
- Ready for persistent internal deployment.

Operational evidence update (2026-02-19):
- Playwright BFF-mode evidence pass completed for login/bootstrap/send/realtime/upload/download flows on `http://debian-dev.lan:8081`.
- Captured BFF-only request traces showing `/bff/*` route usage with no direct browser calls to upstream BlueBubbles REST host during the validated session.
- Captured send/upload/download route evidence (`POST /bff/message/text`, `POST /bff/message/attachment`, `GET /bff/attachment/:guid/download`) and realtime event evidence from browser logs.
- During evidence pass, incoming attachment data with `null` MIME type exposed a sidebar crash path in web preview rendering; patched `mimeTypeToPreview`/`mimeTypeToDisplay` to accept nullable MIME types and return stable fallback labels instead of throwing.
- Post-fix validation confirmed no `ListConversation` runtime crash and continued BFF flow operation.
- Persisted an in-repo evidence handoff record at `evidence/phase4-playwright-evidence.md`.

## Phase 5: Cleanup and default-on rollout
- Make BFF path default.
- Remove or deeply gate legacy direct-auth browser path.
- Update onboarding copy/docs and deprecation notice for direct mode.

Exit criteria:
- BFF is primary transport and credential boundary is enforced by default.

## 9) Testing Strategy

## 9.1 BFF tests
- Unit: auth fallback logic, route validation, credential injection by mode, redaction.
- Integration: mocked BlueBubbles upstream for login/query/send/download/socket flows.
- Security: CSRF validation, cookie flags, blocked route traversal, blocked arbitrary upstream URLs.

## 9.2 Web tests
- Unit/integration updates for `SignInGate` and transport path switching.
- E2E (Playwright): login via BFF, load chats, send message, receive realtime event, download attachment.

## 10) Deployment Topology

Recommended internal deployment:
- `reverse-proxy (nginx/caddy)` terminates TLS.
- Serve web static assets + BFF under same origin (preferred).
- BlueBubbles server reachable only from BFF network segment when possible.

If same-origin is not possible, enforce strict CORS and cookie domain policy.

## 11) Risks and Mitigations

- Risk: session store outage.
  - Mitigation: health checks, fallback to in-memory only for dev, retry/backoff strategy.
- Risk: proxy drift from upstream BlueBubbles API changes.
  - Mitigation: centralized upstream client module + contract tests.
- Risk: accidental credential logging.
  - Mitigation: default redaction middleware and log review tests.
- Risk: mixed direct/BFF mode confusion.
  - Mitigation: explicit feature flag visibility and telemetry tags indicating active transport.

## 12) Immediate Next Work Items

1. Execute Phase 5 rollout work: default BFF transport-on path, deprecate/gate direct mode, and update onboarding copy.
2. Add route-level BFF integration tests (mocked upstream) covering attachment upload/download streaming and CSRF failure envelopes.
3. Capture longer-session reconnect behavior evidence (especially tunnel/cloud deployments) before default-on rollout.
4. Add a focused regression test for nullable attachment MIME-type previews in conversation list rendering.
