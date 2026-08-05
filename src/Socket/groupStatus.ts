import crypto from 'crypto'
import { proto } from '../../WAProto/index.js'
import { generateWAMessageContent, generateWAMessageFromContent } from '../Utils/index.js'
import type { AnyMessageContent, WAMessage } from '../Types/index.js'
import type { WAMediaUploadFunction } from '../Types/Message.js'

export type GroupStatusDeps = {
	relayMessage: (jid: string, message: proto.IMessage, opts: { messageId: string }) => Promise<unknown>
	waUploadToServer: WAMediaUploadFunction
	userJid?: string
}

/**
 * Post a "Group Status" update — a status/story visible only within a single
 * group (proto field: groupStatusMessageV2), distinct from the regular
 * status@broadcast story that goes to your contact list.
 *
 * Accepts the same content shapes as sendMessage: { text }, { image, caption },
 * { video, caption, gifPlayback }, { audio, ptt, mimetype }, { sticker }, etc.
 */
export const sendGroupStatus = async (
	jid: string,
	content: AnyMessageContent,
	deps: GroupStatusDeps
): Promise<WAMessage> => {
	const { relayMessage, waUploadToServer, userJid } = deps

	// generateWAMessageContent builds/uploads the inner message (handles
	// media upload, thumbnails, waveform, etc. same as a normal send)
	const inner = await generateWAMessageContent(content, { upload: waUploadToServer })

	const messageSecret = crypto.randomBytes(32)

	const wrapped = generateWAMessageFromContent(
		jid,
		{
			messageContextInfo: { messageSecret },
			groupStatusMessageV2: {
				message: {
					...inner,
					messageContextInfo: { messageSecret }
				}
			}
		},
		{ userJid } as any
	)

	await relayMessage(jid, wrapped.message!, { messageId: wrapped.key.id! })

	return wrapped
}