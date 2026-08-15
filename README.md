# wolfsocket

A [Baileys](https://github.com/WhiskeySockets/Baileys) fork maintained under **WOLF TECH**, adding native **Group Status** support — posting text, image, video, audio, and sticker updates that are visible only within a specific WhatsApp group (distinct from the regular `status@broadcast` story that goes to your whole contact list).

> This is a fork, not a replacement. Everything in upstream Baileys works exactly the same — `wolfsocket` adds one new socket method on top: `sock.sendGroupStatus()`.

## Install

```bash
npm install wolfsocket
```

## Quick start

Usage is identical to upstream Baileys — same `makeWASocket`, same auth flow, same `sendMessage`. The only addition is `sock.sendGroupStatus()`:

```js
import makeWASocket, { useMultiFileAuthState } from 'wolfsocket'

const { state, saveCreds } = await useMultiFileAuthState('auth_info')
const sock = makeWASocket({ auth: state })
sock.ev.on('creds.update', saveCreds)

// text group status
await sock.sendGroupStatus(groupJid, { text: 'hello from the group status feature' })

// image group status
await sock.sendGroupStatus(groupJid, { image: imageBuffer, caption: 'caption text' })

// video group status
await sock.sendGroupStatus(groupJid, { video: videoBuffer, caption: 'caption', gifPlayback: false })

// audio group status
await sock.sendGroupStatus(groupJid, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true })

// sticker group status
await sock.sendGroupStatus(groupJid, { sticker: stickerBuffer })
```

`groupJid` is a normal group JID (ends in `@g.us`) — the same one you'd pass to `sock.sendMessage()`.

### Sticker compatibility

When a bot receives a sticker and wants to repost it as a group status, it should
parse the sticker into a supported media format before posting it. Convert static
stickers to an image (such as PNG), and convert animated stickers to a video (such
as MP4) so the animation is preserved. Then post the converted media with
`sendGroupStatus()`:

```js
// static sticker converted to an image
await sock.sendGroupStatus(groupJid, { image: imageBuffer })

// animated sticker converted to a video
await sock.sendGroupStatus(groupJid, { video: videoBuffer, gifPlayback: true })
```

## API

### `sock.sendGroupStatus(jid, content)`

| param     | type                                                              | description                                    |
|-----------|-------------------------------------------------------------------|-------------------------------------------------|
| `jid`     | `string`                                                          | group JID (`...@g.us`)                          |
| `content` | `AnyMessageContent`                                               | same content shape accepted by `sock.sendMessage` |

Returns a `Promise<WAMessage>` with the sent message's key.

## What's different from upstream Baileys

- Adds `src/Socket/groupStatus.ts`, wired into `sock.sendGroupStatus()`.
- Fixes a `mediatype` stanza-detection gap in `relayMessage` that caused media (image/video/etc.) group-status posts to silently fail to render correctly, while text posts worked fine. See `CHANGES.md` for details.
- No other behavior changes — everything else is stock Baileys.

## License

MIT — see [LICENSE](./LICENSE). This package is a modified fork of [Baileys](https://github.com/WhiskeySockets/Baileys) by Rajeh Taher / WhiskeySockets, used under its original MIT license. The original copyright notice is preserved in full; modifications and additions (including Group Status support) by Briton Kiplangat (Silent Wolf) / WOLF TECH are licensed under the same terms.
