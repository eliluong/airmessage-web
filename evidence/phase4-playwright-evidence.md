# Phase 4 Playwright BFF E2E Evidence

Date: 2026-02-19
Environment: `http://debian-dev.lan:8081` with BFF proxy to `http://127.0.0.1:3100`

## Evidence Summary
- Bootstrap/session routes observed via browser network:
  - `GET /bff/session/status` -> `200`
  - `GET /bff/server/info` -> `200`
  - `GET /bff/server/features` -> `404` (handled by client fallback)
  - `POST /bff/chat/query` -> `200`
  - `POST /bff/message/query` -> `200`
- Send text:
  - `POST /bff/message/text` -> `200`
- Drag/drop attachment send:
  - `POST /bff/message/attachment` -> `200`
- Attachment fetch path:
  - `GET /bff/attachment/:guid/download?...` -> `200` (multiple guids observed)
- Realtime receive evidence:
  - Console contained `Realtime message event {eventName: new-message, channelState: connected, ...}` entries.

## Security Boundary Check
- During validated BFF-mode runs, browser requests used `/bff/*` routes.
- No direct browser requests to `xilexs-imac-pro.lan/api/v1/*` were observed in the validated BFF traces.

## Incident During Evidence Run
- Symptom: app blanked after drag/send due to sidebar preview crash.
- Cause: `mimeTypeToPreview()` called with nullable attachment MIME (`null`).
- Fix applied: `src/util/conversationUtils.ts` now accepts nullable MIME inputs in `mimeTypeToDisplay()` and `mimeTypeToPreview()`.
- Post-fix: app recovered; send/realtime behavior continued successfully.

## Artifact Retention Note
- Raw Playwright MCP files were generated under the MCP runtime path (outside repo workspace).
- This file is the persisted in-repo evidence record used for continuity and Phase 5 handoff.
