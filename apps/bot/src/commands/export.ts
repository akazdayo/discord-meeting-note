import type { ChatInputCommandInteraction } from "discord.js";
import { AttachmentBuilder, SlashCommandBuilder } from "discord.js";
import type { AppServices, Command } from "./index.js";

export function createExportCommand(services: AppServices): Command {
	const { db } = services;

	const data = new SlashCommandBuilder()
		.setName("export")
		.setDescription("セッションデータを書き出します")
		.addSubcommand((sub) =>
			sub
				.setName("audio")
				.setDescription("録音音声ファイルを書き出します")
				.addStringOption((opt) =>
					opt.setName("id").setDescription("セッション ID").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("transcript")
				.setDescription("文字起こし結果を書き出します")
				.addStringOption((opt) =>
					opt.setName("id").setDescription("セッション ID").setRequired(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("summary")
				.setDescription("要約を書き出します")
				.addStringOption((opt) =>
					opt.setName("id").setDescription("セッション ID").setRequired(true),
				),
		);

	const execute = async (interaction: Parameters<Command["execute"]>[0]) => {
		const sub = interaction.options.getSubcommand();
		const id = interaction.options.getString("id", true);

		const session = db.getSession(id);
		if (!session) {
			await interaction.reply({
				content: `セッション \`${id}\` が見つかりません。`,
				ephemeral: true,
			});
			return;
		}

		if (sub === "audio") {
			if (!session.audioPath) {
				await interaction.reply({
					content: "音声ファイルは削除されています（TTL 切れ）。",
					ephemeral: true,
				});
				return;
			}
			if (session.status !== "done") {
				await interaction.reply({
					content: "まだ処理中です。完了後に再試行してください。",
					ephemeral: true,
				});
				return;
			}
			const attachment = new AttachmentBuilder(session.audioPath, {
				name: `${id}.ogg`,
			});
			await interaction.reply({ files: [attachment] });
		} else if (sub === "transcript") {
			const transcript = db.getTranscript(id);
			if (!transcript) {
				await interaction.reply({
					content: "文字起こし結果がまだありません。",
					ephemeral: true,
				});
				return;
			}
			await replyText(interaction, transcript.content, `transcript_${id}.txt`);
		} else if (sub === "summary") {
			const summary = db.getSummary(id);
			if (!summary) {
				await interaction.reply({
					content: "要約がまだありません。",
					ephemeral: true,
				});
				return;
			}
			await replyText(interaction, summary.content, `summary_${id}.md`);
		}
	};

	return { data, execute };
}

async function replyText(
	interaction: ChatInputCommandInteraction,
	content: string,
	filename: string,
): Promise<void> {
	if (!content.trim()) {
		await interaction.reply({ content: "（内容が空です）", ephemeral: true });
		return;
	}
	if (content.length <= 2000) {
		await interaction.reply({ content });
	} else {
		const attachment = new AttachmentBuilder(Buffer.from(content, "utf-8"), {
			name: filename,
		});
		await interaction.reply({ files: [attachment] });
	}
}
