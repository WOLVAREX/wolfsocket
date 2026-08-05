/**
 * Minimal connect-and-test script for the sendGroupStatus patch.
 *
 * Run with:  npx tsx Example/test-groupstatus.ts
 *
 * 1. Scan the QR code with WhatsApp (Linked Devices > Link a Device)
 * 2. Once connected, in any group your account is in:
 *      - send text:                       !teststatus
 *        -> posts a text group-status
 *      - send an image/video with caption "!teststatus"
 *        -> posts that image/video as a group-status
 *      - reply "!teststatus" to an existing image/video/sticker/audio
 *        -> downloads the quoted media and posts it as a group-status
 */
import makeWASocket, {
	DisconnectReason,
	downloadContentFromMessage,
	fetchLatestBaileysVersion,
	makeCacheableSignalKeyStore,
	useMultiFileAuthState
} from './src'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import P from 'pino'

const logger = P({ level: 'debug' }) // turn down to 'silent' once things work

const TRIGGER = '!teststatus'

type DownloadableType = 'image' | 'video' | 'audio' | 'sticker'

async function downloadToBuffer(mediaMessage: any, type: DownloadableType) {
	const stream = await downloadContentFromMessage(mediaMessage, type)
	let buffer = Buffer.from([])
	for await (const chunk of stream) {
		buffer = Buffer.concat([buffer, chunk])
	}
	return buffer
}

async function start() {
	const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
	const { version } = await fetchLatestBaileysVersion()

	const sock = makeWASocket({
		version,
		logger,
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, logger)
		}
	})

	sock.ev.on('creds.update', saveCreds)

	sock.ev.on('connection.update', update => {
		const { connection, lastDisconnect, qr } = update

		console.log('[debug] connection.update:', JSON.stringify({ connection, hasQr: !!qr }))

		if (qr) {
			console.log('\nScan this QR code with WhatsApp (Linked Devices > Link a Device):\n')
			qrcode.generate(qr, { small: true })
		}

		if (connection === 'close') {
			const shouldReconnect =
				(lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
			console.log('connection closed', lastDisconnect?.error, 'reconnecting:', shouldReconnect)
			if (shouldReconnect) {
				start()
			}
		} else if (connection === 'open') {
			console.log('\n✅ Connected! Send "!teststatus" in a group to test.\n')
		}
	})

	sock.ev.on('messages.upsert', async ({ messages, type }) => {
		console.log(`[debug] messages.upsert fired | type=${type} | count=${messages.length}`)
		if (type !== 'notify') return

		for (const msg of messages) {
			console.log(
				'[debug] raw key:',
				JSON.stringify(msg.key),
				'| hasMessage:',
				!!msg.message,
				'| messageStubType:',
				msg.messageStubType
			)
			const jid = msg.key.remoteJid
			if (!jid?.endsWith('@g.us')) continue // groups only

			const m = msg.message
			const directImage = m?.imageMessage
			const directVideo = m?.videoMessage
			const extText = m?.extendedTextMessage
			const quoted = extText?.contextInfo?.quotedMessage

			// previously this script ONLY ever checked quoted?.imageMessage --
			// that's why replying to a video/sticker/audio fell through to the
			// plain-text branch below instead of posting the media
			const quotedImage = quoted?.imageMessage
			const quotedVideo = quoted?.videoMessage
			const quotedSticker = quoted?.stickerMessage
			const quotedAudio = quoted?.audioMessage
			const quotedMedia = quotedImage || quotedVideo || quotedSticker || quotedAudio

			const plainText = m?.conversation || extText?.text || ''
			const caption = directImage?.caption || directVideo?.caption || ''

			const quotedKind = quotedImage
				? 'image'
				: quotedVideo
				? 'video'
				: quotedSticker
				? 'sticker'
				: quotedAudio
				? 'audio'
				: 'none'

			console.log(
				`[debug] group msg in ${jid} | fromMe=${msg.key.fromMe} | text="${plainText}" | caption="${caption}" | quoted=${quotedKind}`
			)

			// ignore the bot's own status/progress replies so it doesn't loop,
			// but allow fromMe messages that actually contain the trigger
			// (since you're testing solo from your own phone)
			const looksLikeTrigger = plainText.trim() === TRIGGER || caption.trim() === TRIGGER
			if (msg.key.fromMe && !looksLikeTrigger) continue

			try {
				// Case 1: reply "!teststatus" to an existing image/video/sticker/audio.
				// MUST be checked before the plain-text case -- a reply's text also
				// equals TRIGGER via extendedTextMessage.text, so if this check were
				// after (or the quotedMedia check too narrow, as it was before) it
				// falls through to posting a text status instead of the media.
				if (plainText.trim() === TRIGGER && quotedMedia) {
					if (quotedImage) {
						console.log(`[test] posting quoted-reply image group-status to ${jid}`)
						await sock.sendMessage(jid, { text: '⏳ downloading + posting image group status...' })
						const buffer = await downloadToBuffer(quotedImage, 'image')
						await sock.sendGroupStatus(jid, { image: buffer, caption: 'image group-status test (reply)' })
					} else if (quotedVideo) {
						console.log(`[test] posting quoted-reply video group-status to ${jid}`)
						await sock.sendMessage(jid, { text: '⏳ downloading + posting video group status...' })
						const buffer = await downloadToBuffer(quotedVideo, 'video')
						await sock.sendGroupStatus(jid, {
							video: buffer,
							caption: 'video group-status test (reply)',
							gifPlayback: quotedVideo.gifPlayback || false,
							mimetype: quotedVideo.mimetype || 'video/mp4'
						})
					} else if (quotedSticker) {
						console.log(`[test] posting quoted-reply sticker group-status to ${jid}`)
						await sock.sendMessage(jid, { text: '⏳ downloading + posting sticker group status...' })
						const buffer = await downloadToBuffer(quotedSticker, 'sticker')
						await sock.sendGroupStatus(jid, {
							sticker: buffer,
							mimetype: quotedSticker.mimetype || 'image/webp'
						})
					} else if (quotedAudio) {
						console.log(`[test] posting quoted-reply audio group-status to ${jid}`)
						await sock.sendMessage(jid, { text: '⏳ downloading + posting audio group status...' })
						const buffer = await downloadToBuffer(quotedAudio, 'audio')
						await sock.sendGroupStatus(jid, {
							audio: buffer,
							ptt: quotedAudio.ptt || false,
							mimetype: quotedAudio.mimetype || 'audio/ogg; codecs=opus'
						})
					}

					await sock.sendMessage(jid, { text: '✅ done, check the group status tab' })
					continue
				}

				// Case 2: text-only trigger -> plain text status
				if (plainText.trim() === TRIGGER && !quotedMedia) {
					console.log(`[test] posting text group-status to ${jid}`)
					await sock.sendMessage(jid, { text: '⏳ posting text group status...' })
					await sock.sendGroupStatus(jid, { text: `Group status test — ${new Date().toLocaleTimeString()}` })
					await sock.sendMessage(jid, { text: '✅ done, check the group status tab' })
					continue
				}

				// Case 3: image/video sent directly with "!teststatus" as caption
				// (stickers and audio don't carry captions in WhatsApp's protocol,
				// so those can only be tested via the quoted-reply case above)
				if ((directImage || directVideo) && caption.trim() === TRIGGER) {
					if (directImage) {
						console.log(`[test] posting direct image group-status to ${jid}`)
						await sock.sendMessage(jid, { text: '⏳ downloading + posting image group status...' })
						const buffer = await downloadToBuffer(directImage, 'image')
						await sock.sendGroupStatus(jid, { image: buffer, caption: 'image group-status test (direct)' })
					} else if (directVideo) {
						console.log(`[test] posting direct video group-status to ${jid}`)
						await sock.sendMessage(jid, { text: '⏳ downloading + posting video group status...' })
						const buffer = await downloadToBuffer(directVideo, 'video')
						await sock.sendGroupStatus(jid, {
							video: buffer,
							caption: 'video group-status test (direct)',
							gifPlayback: directVideo.gifPlayback || false,
							mimetype: directVideo.mimetype || 'video/mp4'
						})
					}

					await sock.sendMessage(jid, { text: '✅ done, check the group status tab' })
					continue
				}
			} catch (err) {
				console.error('[test] failed:', err)
				await sock.sendMessage(jid, { text: `❌ failed: ${(err as Error).message}` }).catch(() => {})
			}
		}
	})
}

start()