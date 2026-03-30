import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { DiscordError } from "@discord-meeting-note/errors";
import {
	EndBehaviorType,
	entersState,
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

	async startSession(channel: VoiceBasedChannel, sessionId: string): Promise<void> {
		console.log(`[VoiceManager] startSession: sessionId=${sessionId} channel=${channel.name}`);
		this._isRecording = true;
		this.currentSessionId = sessionId;
		this.recordingChunks = [];
		await this.join(channel);
	}

	async stopSession(): Promise<string | null> {
		if (!this.currentSessionId) {
			throw new Error("No active recording session");
		}
		const sessionId = this.currentSessionId;
		console.log(`[VoiceManager] stopSession: sessionId=${sessionId} chunks=${this.recordingChunks.length}`);
		this._isRecording = false;
		this.leave();

		if (this.recordingChunks.length === 0) {
			console.log("[VoiceManager] stopSession: no audio chunks recorded");
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

	private async join(channel: VoiceBasedChannel): Promise<void> {
		// 既存のゾンビ接続を先に破棄
		const existing = getVoiceConnection(channel.guild.id);
		if (existing) {
			console.log(`[VoiceManager] destroying existing connection (status=${existing.state.status})`);
			existing.destroy();
		}

		this.guildId = channel.guild.id;
		console.log(`[VoiceManager] join: channelId=${channel.id} guildId=${channel.guild.id}`);

		const connection = joinVoiceChannel({
			channelId: channel.id,
			guildId: channel.guild.id,
			adapterCreator: channel.guild.voiceAdapterCreator,
			selfDeaf: false,
		});

		connection.on("stateChange", (oldState, newState) => {
			console.log(`[VoiceManager] connection state: ${oldState.status} -> ${newState.status}`);
		});

		connection.on("debug", (message) => {
			console.log(`[VoiceManager:debug] ${message}`);
		});

		connection.on(VoiceConnectionStatus.Disconnected, async () => {
			console.log("[VoiceManager] connection disconnected — checking if reconnecting");
			try {
				await Promise.race([
					entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
					entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
				]);
				console.log("[VoiceManager] reconnecting...");
			} catch {
				console.log("[VoiceManager] could not reconnect, destroying connection");
				connection.destroy();
				this.cleanup();
			}
		});

		connection.on("error", (error) => {
			console.error("[VoiceManager] connection error:", error);
			this.emit("error", new DiscordError("Voice connection error", error));
		});

		// Ready になるまで待つ（最大 30 秒）、失敗時は接続を破棄してリセット
		try {
			await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
		} catch (error) {
			console.error("[VoiceManager] failed to reach Ready state, destroying connection");
			connection.destroy();
			this.guildId = null;
			throw error;
		}

		console.log(`[VoiceManager] connection ready in ${channel.name}`);
		this.startListening(connection);
	}

	private startListening(connection: VoiceConnection): void {
		const { receiver } = connection;
		console.log("[VoiceManager] startListening: waiting for speaking events");

		receiver.speaking.on("start", (userId) => {
			console.log(`[VoiceManager] speaking start: userId=${userId} isRecording=${this._isRecording} alreadyActive=${this.activeStreams.has(userId)}`);
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

			let chunkCount = 0;
			stream.pipe(decoder).on("data", (chunk: Buffer) => {
				chunkCount++;
				if (chunkCount === 1) {
					console.log(`[VoiceManager] first audio chunk from userId=${userId} isRecording=${this._isRecording}`);
				}
				if (this._isRecording) {
					this.recordingChunks.push({
						userId,
						timestamp: Date.now(),
						data: chunk,
					});
				} else {
					console.log(`[VoiceManager] chunk dropped (not recording) userId=${userId}`);
				}
			});

			stream.on("end", () => {
				console.log(`[VoiceManager] stream end: userId=${userId} chunks=${chunkCount}`);
				this.activeStreams.delete(userId);
			});

			stream.on("error", (error) => {
				console.error(`[VoiceManager] stream error: userId=${userId}`, error);
				this.activeStreams.delete(userId);
				this.emit(
					"error",
					new DiscordError(`Audio stream error for user ${userId}`, error),
				);
			});
		});

		receiver.speaking.on("end", (userId) => {
			console.log(`[VoiceManager] speaking end: userId=${userId}`);
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
