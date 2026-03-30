import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import type { AudioBuffer } from "@discord-meeting-note/types";
import { commands } from "./commands/index.js";
import { VoiceManager } from "./voice-manager.js";

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildMembers,
	],
});

const voiceManager = new VoiceManager();

voiceManager.on("audioSegment", (userId: string, audio: AudioBuffer) => {
	console.log(
		`audioSegment: userId=${userId}, duration=${audio.durationMs.toFixed(0)}ms, bytes=${audio.data.length}`,
	);
	// TODO: pass to transcription pipeline
});

voiceManager.on("error", (error: Error) => {
	console.error("VoiceManager error:", error);
});

const commandMap = new Map(commands.map((cmd) => [cmd.data.name, cmd]));

client.once("ready", async () => {
	console.log(`Logged in as ${client.user?.tag}`);

	const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);
	await rest.put(Routes.applicationCommands(client.user!.id), {
		body: commands.map((cmd) => cmd.data.toJSON()),
	});
	console.log("Slash commands registered");
});

client.on("interactionCreate", async (interaction) => {
	if (!interaction.isChatInputCommand()) return;

	const command = commandMap.get(interaction.commandName);
	if (command) {
		await command.execute(interaction, voiceManager);
	}
});

client.login(process.env.DISCORD_TOKEN);
