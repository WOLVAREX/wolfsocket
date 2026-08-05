import { proto } from '../../WAProto/index.js'
import { generateWAMessageContent } from '../Utils/index.js'
import type { AnyMessageContent, WAMessage } from '../Types/index.js'
import type { WAMediaUploadFunction } from '../Types/Message.js'

export type GroupStatusDeps = {
	relayMessage: (jid: string, message: proto.IMessage, opts: { messageId: string }) => Promise<unknown>
	waUploadToServer: WAMediaUploadFunction
	generateMessageId: () => string
}

/**
 * Post a "Group Status" update — a status/story visible only within a single
 * group (proto field: groupStatusMessageV2), distinct from the regular
 * status@broadcast story that goes to your contact list.
 *
 * Mirrors the reference implementation: builds the inner content via
 * generateWAMessageContent (handles media upload/thumbnails same as a normal
 * send), wraps it directly in groupStatusMessageV2, and relays it as-is --
 * no extra generateWAMessageFromContent wrapping, no injected messageSecret,
 * since the working reference implementation doesn't use either.
 */
export const sendGroupStatus = async (
	jid: string,
	content: AnyMessageContent,
	deps: GroupStatusDeps
): Promise<WAMessage> => {
	const { relayMessage, waUploadToServer, generateMessageId } = deps

	const inner: any = await generateWAMessageContent(content, { upload: waUploadToServer })

	const msgPayload: proto.IMessage = {
		groupStatusMessageV2: {
			message: inner.message || inner
		}
	}

	const messageId = generateMessageId()
	await relayMessage(jid, msgPayload, { messageId })

	return {
		key: { remoteJid: jid, id: messageId, fromMe: true },
		message: msgPayload
	} as WAMessage
}