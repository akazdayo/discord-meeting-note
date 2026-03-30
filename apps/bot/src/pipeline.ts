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
	if (!session?.audioPath) {
		throw new Error(`Session ${sessionId} has no audio path`);
	}

	try {
		// Transcribe
		const transcriptionResult = await transcriber.transcribeFile(
			session.audioPath,
		);
		db.saveTranscript({
			sessionId,
			provider: "whisper",
			content: transcriptionResult.text,
		});

		// Summarize
		const llmResponse = await llm.complete(
			buildSummarizationMessages(transcriptionResult.text),
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
