import {
	ChannelType,
	SlashCommandBuilder,
	type VoiceChannel,
} from "discord.js";
import { processSession } from "../pipeline.js";
import type { AppServices, Command } from "./index.js";

export function createRecordCommand(services: AppServices): Command {
	const { voiceManager, db, transcriber, llm, client } = services;

	const data = new SlashCommandBuilder()
		.setName("record")
		.setDescription("録音セッションを管理します")
		.addSubcommand((sub) =>
			sub
				.setName("start")
				.setDescription("ボイスチャンネルへ参加して録音を開始します")
				.addChannelOption((opt) =>
					opt
						.setName("channel")
						.setDescription(
							"参加するボイスチャンネル（省略時は現在いるチャンネル）",
						)
						.addChannelTypes(ChannelType.GuildVoice)
						.setRequired(false),
				),
		)
		.addSubcommand((sub) =>
			sub.setName("stop").setDescription("録音を停止して処理を開始します"),
		);

	const execute = async (interaction: Parameters<Command["execute"]>[0]) => {
		const sub = interaction.options.getSubcommand();

		if (sub === "start") {
			if (voiceManager.isRecording) {
				await interaction.reply({
					content: "すでに録音中です。先に `/record stop` で停止してください。",
					ephemeral: true,
				});
				return;
			}

			const channelOption = interaction.options.getChannel(
				"channel",
			) as VoiceChannel | null;
			const member = interaction.guild?.members.cache.get(interaction.user.id);
			const channel = (channelOption ?? member?.voice.channel) as
				| VoiceChannel
				| undefined;

			if (!channel || channel.type !== ChannelType.GuildVoice) {
				await interaction.reply({
					content:
						"参加するボイスチャンネルが見つかりません。ボイスチャンネルに入るか、チャンネルを指定してください。",
					ephemeral: true,
				});
				return;
			}

			const session = db.createSession({
				guildId: interaction.guildId ?? "",
				channelId: interaction.channelId,
				requestedBy: interaction.user.id,
			});

			voiceManager.startSession(channel, session.id);

			await interaction.reply(
				`録音を開始しました。セッション ID: \`${session.id}\`\n停止するには \`/record stop\` を使用してください。`,
			);
		} else if (sub === "stop") {
			if (!voiceManager.isRecording) {
				await interaction.reply({
					content: "録音中ではありません。",
					ephemeral: true,
				});
				return;
			}

			const sessionId = voiceManager.sessionId;
			if (!sessionId) {
				await interaction.reply({
					content: "セッションが見つかりません。",
					ephemeral: true,
				});
				return;
			}

			await interaction.deferReply();

			try {
				const audioPath = await voiceManager.stopSession();

				if (audioPath === null) {
					db.updateSessionStatus(sessionId, "failed");
					await interaction.editReply(
						"録音を停止しましたが、音声データが記録されていませんでした。",
					);
					return;
				}

				db.updateSessionStatus(sessionId, "processing");
				db.updateSessionAudioPath(sessionId, audioPath);

				await interaction.editReply(
					`録音を停止しました。セッション ID: \`${sessionId}\`\n文字起こし・要約処理中です…完了後にお知らせします。`,
				);

				processSession(sessionId, db, transcriber, llm, client).catch((err) => {
					console.error(`processSession failed for ${sessionId}:`, err);
				});
			} catch (err) {
				console.error("Failed to stop session:", err);
				await interaction.editReply("録音の停止中にエラーが発生しました。");
			}
		}
	};

	return { data, execute };
}
