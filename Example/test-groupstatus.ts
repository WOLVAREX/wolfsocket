/**
 * Minimal connect-and-test script for the sendGroupStatus patch.
 *
 * Run with:  npx tsx Example/test-groupstatus.ts
 *
 * 1. Scan the QR code with WhatsApp (Linked Devices > Link a Device)
 * 2. Once connected, in any group your account is in:
 *      - send text:            !teststatus
 *        -> posts a text group-status
 *      - send an image with caption "!teststatus"
 *        -> posts that image as a group-status
 *      - reply "!teststatus" to an existing image in the chat
 *        -> downloads the quoted image and posts it as a group-status
 */
import makeWASocket, {
	DisconnectReason,
	downloadContentFromMessage,
	fetchLatestBaileysVersion,
	makeCacheableSignalKeyStore,
	useMultiFileAuthState
} from '../src'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import P from 'pino'

const logger = P({ level: 'debug' }) // turn down to 'silent' once things work

const TRIGGER = '!teststatus'

async function downloadToBuffer(mediaMessage: any, type: 'image' | 'video' | 'audio' | 'sticker') {
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

	sock.ev.on('connection.update', (update) => {
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
			console.log('[debug] raw key:', JSON.stringify(msg.key), '| hasMessage:', !!msg.message, '| messageStubType:', msg.messageStubType)
			const jid = msg.key.remoteJid
			if (!jid?.endsWith('@g.us')) continue // groups only

			const m = msg.message
			const directImage = m?.imageMessage
			const extText = m?.extendedTextMessage
			const quoted = extText?.contextInfo?.quotedMessage
			const quotedImage = quoted?.imageMessage

			const plainText = m?.conversation || extText?.text || ''
			const caption = directImage?.caption || ''

			console.log(`[debug] group msg in ${jid} | fromMe=${msg.key.fromMe} | text="${plainText}" | caption="${caption}" | hasQuotedImage=${!!quotedImage}`)

			// ignore the bot's own status/progress replies so it doesn't loop,
			// but allow fromMe messages that actually contain the trigger
			// (since you're testing solo from your own phone)
			const looksLikeTrigger =
				plainText.trim() === TRIGGER || caption.trim() === TRIGGER
			if (msg.key.fromMe && !looksLikeTrigger) continue

			try {
				// Case 1: text-only trigger -> plain text status
				if (plainText.trim() === TRIGGER && !quotedImage) {
					console.log(`[test] posting text group-status to ${jid}`)
					await sock.sendMessage(jid, { text: '⏳ posting text group status...' })
					await sock.sendGroupStatus(jid, { text: `Group status test — ${new Date().toLocaleTimeString()}` })
					await sock.sendMessage(jid, { text: '✅ done, check the group status tab' })
					continue
				}

				// Case 2: image sent directly with "!teststatus" as caption
				if (directImage && caption.trim() === TRIGGER) {
					console.log(`[test] posting direct image group-status to ${jid}`)
					await sock.sendMessage(jid, { text: '⏳ downloading + posting image group status...' })
					const buffer = await downloadToBuffer(directImage, 'image')
					await sock.sendGroupStatus(jid, { image: buffer, caption: 'image group-status test (direct)' })
					await sock.sendMessage(jid, { text: '✅ done, check the group status tab' })
					continue
				}

				// Case 3: replying "!teststatus" to an existing image
				if (plainText.trim() === TRIGGER && quotedImage) {
					console.log(`[test] posting quoted-reply image group-status to ${jid}`)
					await sock.sendMessage(jid, { text: '⏳ downloading + posting image group status...' })
					const buffer = await downloadToBuffer(quotedImage, 'image')
					await sock.sendGroupStatus(jid, { image: buffer, caption: 'image group-status test (reply)' })
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