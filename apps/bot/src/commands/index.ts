import type { DatabaseService } from "@discord-meeting-note/database";
import type { OpenAILLM } from "@discord-meeting-note/llm-openai";
import type { MlxWhisperTranscription } from "@discord-meeting-note/transcription-mlx-whisper";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { VoiceManager } from "../voice-manager.js";
import { createExportCommand } from "./export.js";
import { createRecordCommand } from "./record.js";
import { createSummarizeCommand } from "./summarize.js";

export interface AppServices {
	voiceManager: VoiceManager;
	db: DatabaseService;
	transcriber: MlxWhisperTranscription;
	llm: OpenAILLM;
	client: Client;
	audioDir: string;
}

export interface Command {
	data: { name: string; toJSON(): unknown };
	execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export function createCommands(services: AppServices): Command[] {
	return [
		createRecordCommand(services),
		createExportCommand(services),
		createSummarizeCommand(services),
	];
}
