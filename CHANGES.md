# Changes from upstream Baileys (v7.0.0-rc14 base)

## Added

- **`sock.sendGroupStatus(jid, content)`** — posts a Group Status update
  (`groupStatusMessageV2`), visible only within the target group. Supports
  the same content shapes as `sendMessage`: `{ text }`, `{ image, caption }`,
  `{ video, caption, gifPlayback }`, `{ audio, mimetype, ptt }`, `{ sticker }`.
  New file: `src/Socket/groupStatus.ts`.

## Fixed

- **`mediatype` stanza attribute for wrapped message types.** In
  `src/Socket/messages-send.ts`, `relayMessage` computed the outgoing
  stanza's `mediatype` attribute via `getMediaType(message)` using the raw,
  un-normalized message object. For message types that wrap their real
  content one level deep — `groupStatusMessageV2`, and by extension
  `ephemeralMessage` / `viewOnceMessage` / `viewOnceMessageV2` when used the
  same way — the actual `imageMessage`/`videoMessage`/etc. was invisible to
  this check, so `mediatype` was silently never set.

  This was already inconsistent with `getMessageType` a few lines away in
  the same file, which *does* normalize first via `normalizeMessageContent`
  before inspecting content. Text-only group-status posts worked fine
  (no media attribute needed); image/video/audio/sticker posts relayed
  without error but failed to render correctly, since the resulting stanza
  was indistinguishable from a plain text message at the protocol level.

  Fix: `getMediaType(message)` -> `getMediaType(normalizeMessageContent(message) || message)`,
  matching the pattern already used by `getMessageType`.

## Unchanged

Everything else is stock Baileys — same API surface, same auth flow, same
event system. This fork adds one new socket method and fixes one detection
bug; it does not modify any other existing behavior.