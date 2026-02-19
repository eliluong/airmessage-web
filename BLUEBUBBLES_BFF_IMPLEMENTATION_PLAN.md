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
- `bffApi.ts`: calls `/bff/*` instead of direct BlueBubbles `/api/v1/*`.
- `bffRealtimeChannel.ts`: connects to `/bff/socket`.

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
- Guardrail: if `BFF_ENABLED` is turned on before Phase 1, runtime fails explicitly with a not-implemented BFF error (no silent fallback to direct credentials flow).

Exit criteria:
- No behavior change in production path.
- CI green.

## Phase 1: Minimal BFF with session auth + core read APIs
- Implement `POST /bff/session/login`, `GET /bff/session/status`, `POST /bff/session/logout`.
- Implement read-only proxy routes needed for initial app load:
  - server info/features
  - chat query/count/single
  - chat messages
- Web client behind flag uses BFF for login + chat/thread bootstrap.

Exit criteria:
- Browser no longer calls BlueBubbles directly when flag is enabled.
- Chat list and thread open work end-to-end.

## Phase 2: Message send/search + attachment transfer
- Add message mutation routes (`/message/text`, `/message/query`, `/message/attachment`).
- Add attachment download proxy streaming with abort support.
- Implement CSRF protections for mutating endpoints.

Exit criteria:
- Send text, search, upload attachment, and download attachment all work through BFF.

## Phase 3: Realtime socket bridge
- BFF maintains upstream socket auth (`guid`/`socketGuid`) server-side.
- Browser subscribes to `/bff/socket`.
- Forward required events and ack/error handling.
- Keep health-driven fallback logic in client transport.

Exit criteria:
- Realtime receive path functions without direct browser socket to BlueBubbles.

## Phase 4: Hardening + production readiness
- Redis session store and TTL controls.
- Rate limiting, host allowlist, secure deployment docs (TLS termination via reverse proxy).
- Structured metrics (auth failures, proxy latency, reconnect counts, upstream 4xx/5xx).
- Security review checklist and log redaction verification.

Exit criteria:
- Ready for persistent internal deployment.

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

1. Create `bff/` service scaffold with TypeScript + Express + Socket.IO.
2. Implement `POST /bff/session/login`, `GET /bff/session/status`, and `POST /bff/session/logout` with server-side session storage.
3. Implement read-only proxy routes for metadata/chat/thread bootstrap (`/bff/server/*`, `/bff/chat/*`).
4. Add web-side `bffApi.ts` and `bffRealtimeChannel.ts`, then route the existing seam (`src/connection/bluebubbles/transport.ts`) to these implementations when `BFF_ENABLED=true`.
5. Validate Phase 1 end-to-end against a legacy-auth-only server and capture Playwright evidence.
