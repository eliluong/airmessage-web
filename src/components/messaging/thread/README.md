# Messaging thread components

## Media drawer integration
- `DetailThread` exposes the media drawer toggle through `DetailFrame` only when a BlueBubbles session is active, and passes the selected conversation into `ConversationMediaDrawer`. 【F:src/components/messaging/thread/DetailThread.tsx†L692-L748】
- `ConversationMediaDrawer` orchestrates attachment fetching: it subscribes to `useConversationMedia` for paginated metadata and requests previews through `ConnectionManager.fetchAttachment` when users open tiles. 【F:src/components/messaging/thread/ConversationMediaDrawer.tsx†L103-L210】
- `useConversationMedia` currently supports only BlueBubbles transports and surfaces user-visible errors for unsynced or local-only conversations; extending other proxies will require filling in equivalent REST endpoints. 【F:src/state/useConversationMedia.ts†L127-L214】
