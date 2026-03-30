import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./index.js";

export const leave: Command = {
	data: new SlashCommandBuilder()
		.setName("leave")
		.setDescription("ボイスチャンネルから退出します"),

	async execute(interaction, voiceManager) {
		voiceManager.leave();
		await interaction.reply({ content: "ボイスチャンネルから退出しました。" });
	},
};
