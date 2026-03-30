import * as fs from "node:fs";
import * as path from "node:path";
import { SlashCommandBuilder } from "discord.js";
import { processSession } from "../pipeline.js";
import type { AppServices, Command } from "./index.js";

export function createSummarizeCommand(services: AppServices): Command {
	const { db, transcriber, llm, client, audioDir } = services;

	const data = new SlashCommandBuilder()
		.setName("summarize")
		.setDescription("添付音声ファイルを文字起こし・要約します")
		.addAttachmentOption((opt) =>
			opt
				.setName("audio")
				.setDescription("音声ファイル（OGG, MP3, WAV 等）")
				.setRequired(true),
		);

	const execute = async (interaction: Parameters<Command["execute"]>[0]) => {
		await interaction.deferReply();

		const attachment = interaction.options.getAttachment("audio", true);
		const ext = path.extname(attachment.name) || ".ogg";

		const session = db.createSession({
			guildId: interaction.guildId ?? "",
			channelId: interaction.channelId,
			requestedBy: interaction.user.id,
		});
		db.updateSessionStatus(session.id, "processing");

		// Download attachment to audio dir
		const destPath = path.join(audioDir, `${session.id}${ext}`);

		try {
			const response = await fetch(attachment.url);
			const arrayBuffer = await response.arrayBuffer();
			fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
		} catch (err) {
			console.error("Failed to download attachment:", err);
			await interaction.editReply("音声ファイルのダウンロードに失敗しました。");
			return;
		}

		db.saveSessionTrack({
			sessionId: session.id,
			userId: interaction.user.id,
			audioPath: destPath,
		});

		await interaction.editReply(
			`セッション \`${session.id}\` を作成しました。処理中です…完了後にお知らせします。`,
		);

		processSession(session.id, db, transcriber, llm, client).catch((err) => {
			console.error(`processSession failed for ${session.id}:`, err);
		});
	};

	return { data, execute };
}
