import type { DatabaseService } from "@discord-meeting-note/database";
import type { OpenAILLM } from "@discord-meeting-note/llm-openai";
import type { WhisperTranscription } from "@discord-meeting-note/transcription-whisper";
import type { LLMMessage } from "@discord-meeting-note/types";
import type { Client, SendableChannels } from "discord.js";

export async function processSession(
	sessionId: string,
	db: DatabaseService,
	transcriber: WhisperTranscription,
	llm: OpenAILLM,
	client: Client,
): Promise<void> {
	const session = db.getSession(sessionId);
	if (!session) {
		throw new Error(`Session ${sessionId} not found`);
	}

	const tracks = db.getSessionTracks(sessionId);
	if (tracks.length === 0) {
		throw new Error(`Session ${sessionId} has no audio tracks`);
	}

	try {
		// Fetch guild for display name resolution
		const guild = await client.guilds.fetch(session.guildId).catch(() => null);

		// Transcribe each user track and combine
		const parts: string[] = [];
		for (const track of tracks) {
			if (!track.audioPath) continue;

			let displayName = track.userId;
			if (guild) {
				const member = await guild.members
					.fetch(track.userId)
					.catch(() => null);
				if (member) displayName = member.displayName;
			}

			const result = await transcriber.transcribeFile(track.audioPath);
			if (result.text.trim()) {
				parts.push(`[${displayName}]:\n${result.text.trim()}`);
			}
		}

		const combinedTranscript = parts.join("\n\n");
		db.saveTranscript({
			sessionId,
			provider: "whisper",
			content: combinedTranscript || "(音声なし)",
		});

		// Summarize
		const llmResponse = await llm.complete(
			buildSummarizationMessages(combinedTranscript),
		);
		db.saveSummary({
			sessionId,
			provider: "openai",
			content: llmResponse.content,
		});

		// Mark done
		db.updateSessionStatus(sessionId, "done", Date.now());

		// Notify user
		const channel = await client.channels.fetch(session.channelId);
		if (channel?.isTextBased() && !channel.isDMBased()) {
			await (channel as SendableChannels).send(
				`<@${session.requestedBy}> セッション \`${sessionId}\` の処理が完了しました。\`/export summary ${sessionId}\` で確認できます。`,
			);
		}
	} catch (err) {
		db.updateSessionStatus(sessionId, "failed");
		throw err;
	}
}

function buildSummarizationMessages(transcript: string): LLMMessage[] {
	return [
		{
			role: "system",
			content:
				"あなたは議事録アシスタントです。以下の文字起こしを「要約」「決定事項」「アクションアイテム」のセクションで整理してください。Markdown形式で出力してください。",
		},
		{
			role: "user",
			content: `文字起こし:\n\n${transcript}`,
		},
	];
}
