import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseService } from "@discord-meeting-note/database";
import { OpenAILLM } from "@discord-meeting-note/llm-openai";
import { MlxWhisperTranscription } from "@discord-meeting-note/transcription-mlx-whisper";
import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { startCleanupScheduler } from "./cleanup.js";
import { type AppServices, createCommands } from "./commands/index.js";
import { VoiceManager } from "./voice-manager.js";

const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");
const AUDIO_DIR = path.join(DATA_DIR, "audio");
const DB_PATH = path.join(DATA_DIR, "db.sqlite");

fs.mkdirSync(AUDIO_DIR, { recursive: true });

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildMembers,
	],
});

const db = new DatabaseService(DB_PATH);
const transcriber = new MlxWhisperTranscription();
const llm = new OpenAILLM();
const voiceManager = new VoiceManager(AUDIO_DIR);

const services: AppServices = {
	voiceManager,
	db,
	transcriber,
	llm,
	client,
	audioDir: AUDIO_DIR,
};
const commands = createCommands(services);
const commandMap = new Map(commands.map((cmd) => [cmd.data.name, cmd]));

voiceManager.on("error", (error: Error) => {
	console.error("VoiceManager error:", error);
});

client.once("ready", async () => {
	console.log(`Logged in as ${client.user?.tag}`);

	const token = process.env.DISCORD_TOKEN ?? "";
	const rest = new REST({ version: "10" }).setToken(token);
	const appId = client.user?.id ?? "";
	await rest.put(Routes.applicationCommands(appId), {
		body: commands.map((cmd) => cmd.data.toJSON()),
	});
	console.log("Slash commands registered");

	startCleanupScheduler(db);
});

client.on("interactionCreate", async (interaction) => {
	if (!interaction.isChatInputCommand()) return;

	const command = commandMap.get(interaction.commandName);
	if (command) {
		await command.execute(interaction);
	}
});

client.login(process.env.DISCORD_TOKEN ?? "");
