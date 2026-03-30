import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { DiscordError } from "@discord-meeting-note/errors";
import {
	EndBehaviorType,
	getVoiceConnection,
	joinVoiceChannel,
	type VoiceConnection,
	VoiceConnectionStatus,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
import prism from "prism-media";

const execFileAsync = promisify(execFile);

interface TimestampedChunk {
	userId: string;
	timestamp: number;
	data: Buffer;
}

export class VoiceManager extends EventEmitter {
	private guildId: string | null = null;
	private activeStreams = new Set<string>();
	private recordingChunks: TimestampedChunk[] = [];
	private currentSessionId: string | null = null;
	private _isRecording = false;

	constructor(private readonly audioDir: string) {
		super();
	}

	get isRecording(): boolean {
		return this._isRecording;
	}

	get sessionId(): string | null {
		return this.currentSessionId;
	}

	startSession(channel: VoiceBasedChannel, sessionId: string): void {
		this._isRecording = true;
		this.currentSessionId = sessionId;
		this.recordingChunks = [];
		this.join(channel);
	}

	async stopSession(): Promise<string | null> {
		if (!this.currentSessionId) {
			throw new Error("No active recording session");
		}
		const sessionId = this.currentSessionId;
		this._isRecording = false;
		this.leave();

		if (this.recordingChunks.length === 0) {
			this.currentSessionId = null;
			return null;
		}

		// Sort chunks by timestamp and concatenate PCM
		const sorted = [...this.recordingChunks].sort(
			(a, b) => a.timestamp - b.timestamp,
		);
		const pcm = Buffer.concat(sorted.map((c) => c.data));

		// Write temp PCM file
		const tmpPcm = path.join(os.tmpdir(), `${sessionId}.pcm`);
		const oggPath = path.join(this.audioDir, `${sessionId}.ogg`);

		fs.writeFileSync(tmpPcm, pcm);
		try {
			await execFileAsync("ffmpeg", [
				"-y",
				"-f",
				"s16le",
				"-ar",
				"48000",
				"-ac",
				"2",
				"-i",
				tmpPcm,
				"-c:a",
				"libopus",
				oggPath,
			]);
		} finally {
			fs.rmSync(tmpPcm, { force: true });
		}

		this.recordingChunks = [];
		this.currentSessionId = null;

		return oggPath;
	}

	private join(channel: VoiceBasedChannel): void {
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

			stream.pipe(decoder).on("data", (chunk: Buffer) => {
				if (this._isRecording) {
					this.recordingChunks.push({
						userId,
						timestamp: Date.now(),
						data: chunk,
					});
				}
			});

			stream.on("end", () => {
				this.activeStreams.delete(userId);
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
