import type { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import type { VoiceManager } from "../voice-manager.js";
import { join } from "./join.js";
import { leave } from "./leave.js";

export interface Command {
	data: SlashCommandBuilder;
	execute(interaction: ChatInputCommandInteraction, voiceManager: VoiceManager): Promise<void>;
}

export const commands: Command[] = [join, leave];
