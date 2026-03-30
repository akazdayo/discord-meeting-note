import {
	ChannelType,
	SlashCommandBuilder,
	type GuildMember,
	type VoiceBasedChannel,
} from "discord.js";
import type { Command } from "./index.js";

export const join: Command = {
	data: new SlashCommandBuilder()
		.setName("join")
		.setDescription("ボイスチャンネルに参加して録音を開始します")
		.addChannelOption((option) =>
			option
				.setName("channel")
				.setDescription("参加するボイスチャンネル（省略時は現在いるチャンネル）")
				.addChannelTypes(ChannelType.GuildVoice)
				.setRequired(false),
		) as SlashCommandBuilder,

	async execute(interaction, voiceManager) {
		const channelOption = interaction.options.getChannel("channel");
		const member = interaction.member as GuildMember | null;
		const channel = (channelOption ?? member?.voice.channel) as VoiceBasedChannel | null;

		if (!channel) {
			await interaction.reply({
				content: "ボイスチャンネルを指定するか、ボイスチャンネルに参加してから実行してください。",
				ephemeral: true,
			});
			return;
		}

		voiceManager.join(channel);
		await interaction.reply({ content: `**${channel.name}** に参加しました。録音を開始します。` });
	},
};
