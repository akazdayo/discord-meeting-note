import { EventEmitter } from "node:events";
import {
	EndBehaviorType,
	VoiceConnectionStatus,
	getVoiceConnection,
	joinVoiceChannel,
	type VoiceConnection,
} from "@discordjs/voice";
import { DiscordError } from "@discord-meeting-note/errors";
import type { AudioBuffer } from "@discord-meeting-note/types";
import type { VoiceBasedChannel } from "discord.js";
import prism from "prism-media";

export class VoiceManager extends EventEmitter {
	private guildId: string | null = null;
	private activeStreams = new Set<string>();

	join(channel: VoiceBasedChannel): void {
		this.guildId = channel.guild.id;

		const connection = joinVoiceChannel({
			channelId: channel.id,
			guildId: channel.guild.id,
			adapterCreator: channel.guild.voiceAdapterCreator,
			selfDeaf: false,
		});

		connection.on(VoiceConnectionStatus.Ready, () => {
			console.log(`Voice connection ready in ${channel.name}`);
			this.startListening(connection);
		});

		connection.on(VoiceConnectionStatus.Disconnected, () => {
			console.log("Voice connection disconnected");
			this.cleanup();
		});

		connection.on("error", (error) => {
			this.emit("error", new DiscordError("Voice connection error", error));
		});
	}

	private startListening(connection: VoiceConnection): void {
		const { receiver } = connection;

		receiver.speaking.on("start", (userId) => {
			if (this.activeStreams.has(userId)) return;
			this.activeStreams.add(userId);

			const stream = receiver.subscribe(userId, {
				end: {
					behavior: EndBehaviorType.AfterSilence,
					duration: 1000,
				},
			});

			const decoder = new prism.opus.Decoder({
				frameSize: 960,
				channels: 2,
				rate: 48000,
			});

			const chunks: Buffer[] = [];

			stream.pipe(decoder).on("data", (chunk: Buffer) => {
				chunks.push(chunk);
			});

			stream.on("end", () => {
				this.activeStreams.delete(userId);
				if (chunks.length === 0) return;

				const data = Buffer.concat(chunks);
				// 48000 samples/sec * 2 channels * 2 bytes/sample (16-bit PCM)
				const durationMs = (data.length / (48000 * 2 * 2)) * 1000;

				const audio: AudioBuffer = { data, sampleRate: 48000, channels: 2, durationMs };
				this.emit("audioSegment", userId, audio);
			});

			stream.on("error", (error) => {
				this.activeStreams.delete(userId);
				this.emit(
					"error",
					new DiscordError(`Audio stream error for user ${userId}`, error),
				);
			});
		});
	}

	leave(): void {
		if (this.guildId) {
			getVoiceConnection(this.guildId)?.destroy();
			this.cleanup();
		}
	}

	private cleanup(): void {
		this.activeStreams.clear();
		this.guildId = null;
	}
}
