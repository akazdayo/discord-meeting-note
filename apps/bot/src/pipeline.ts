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
	const utterances = db.getSessionUtterances(sessionId);
	if (tracks.length === 0 && utterances.length === 0) {
		throw new Error(`Session ${sessionId} has no audio tracks`);
	}

	try {
		// Fetch guild for display name resolution
		const guild = await client.guilds.fetch(session.guildId).catch(() => null);
		const displayNameCache = new Map<string, string>();

		const resolveDisplayName = async (userId: string): Promise<string> => {
			const cached = displayNameCache.get(userId);
			if (cached) {
				return cached;
			}

			let displayName = userId;
			if (guild) {
				const member = await guild.members.fetch(userId).catch(() => null);
				if (member) {
					displayName = member.displayName;
				}
			}
			displayNameCache.set(userId, displayName);
			return displayName;
		};

		const combinedTranscript =
			utterances.length > 0
				? await buildChronologicalTranscript(
						session.startedAt,
						utterances,
						transcriber,
						resolveDisplayName,
					)
				: await buildTrackTranscript(tracks, transcriber, resolveDisplayName);
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

async function buildChronologicalTranscript(
	sessionStartedAt: number,
	utterances: ReturnType<DatabaseService["getSessionUtterances"]>,
	transcriber: WhisperTranscription,
	resolveDisplayName: (userId: string) => Promise<string>,
): Promise<string> {
	const lines: string[] = [];
	for (const utterance of utterances) {
		if (!utterance.audioPath) continue;

		const result = await transcriber.transcribeFile(utterance.audioPath);
		const text = result.text.trim();
		if (!text) continue;

		const displayName = await resolveDisplayName(utterance.userId);
		const relativeStartMs = utterance.startedAtMs - sessionStartedAt;
		lines.push(
			`[${formatRelativeTime(relativeStartMs)}] ${displayName}: ${text}`,
		);
	}

	return lines.join("\n");
}

async function buildTrackTranscript(
	tracks: ReturnType<DatabaseService["getSessionTracks"]>,
	transcriber: WhisperTranscription,
	resolveDisplayName: (userId: string) => Promise<string>,
): Promise<string> {
	const parts: string[] = [];
	for (const track of tracks) {
		if (!track.audioPath) continue;

		const displayName = await resolveDisplayName(track.userId);
		const result = await transcriber.transcribeFile(track.audioPath);
		if (result.text.trim()) {
			parts.push(`[${displayName}]:\n${result.text.trim()}`);
		}
	}

	return parts.join("\n\n");
}

function formatRelativeTime(relativeMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(relativeMs / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	return [hours, minutes, seconds]
		.map((value) => String(value).padStart(2, "0"))
		.join(":");
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
