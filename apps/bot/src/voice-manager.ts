import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { DiscordError } from "@discord-meeting-note/errors";
import type { UtteranceSegment } from "@discord-meeting-note/types";
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
const MIN_UTTERANCE_DURATION_MS = 300;

export interface UserTrack {
	userId: string;
	audioPath: string;
}

export interface RecordingResult {
	tracks: UserTrack[];
	utterances: UtteranceSegment[];
}

interface ActiveUtterance {
	startedAtMs: number;
	chunks: Buffer[];
}

interface CompletedUtterance {
	userId: string;
	startedAtMs: number;
	endedAtMs: number;
	pcm: Buffer;
}

export class VoiceManager extends EventEmitter {
	private guildId: string | null = null;
	private activeStreams = new Set<string>();
	private recordingChunks: Map<string, Buffer[]> = new Map();
	private activeUtterances: Map<string, ActiveUtterance> = new Map();
	private completedUtterances: CompletedUtterance[] = [];
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

	async startSession(
		channel: VoiceBasedChannel,
		sessionId: string,
	): Promise<void> {
		console.log(
			`[VoiceManager] startSession: sessionId=${sessionId} channel=${channel.name}`,
		);
		this._isRecording = true;
		this.currentSessionId = sessionId;
		this.recordingChunks = new Map();
		this.activeUtterances = new Map();
		this.completedUtterances = [];
		await this.join(channel);
	}

	async stopSession(): Promise<RecordingResult | null> {
		if (!this.currentSessionId) {
			throw new Error("No active recording session");
		}
		const sessionId = this.currentSessionId;
		const totalChunks = [...this.recordingChunks.values()].reduce(
			(n, c) => n + c.length,
			0,
		);
		console.log(
			`[VoiceManager] stopSession: sessionId=${sessionId} users=${this.recordingChunks.size} chunks=${totalChunks}`,
		);
		this._isRecording = false;

		const endedAtMs = Date.now();
		for (const userId of [...this.activeUtterances.keys()]) {
			this.finalizeUtterance(userId, endedAtMs);
		}

		this.leave();

		if (
			this.recordingChunks.size === 0 &&
			this.completedUtterances.length === 0
		) {
			console.log("[VoiceManager] stopSession: no audio chunks recorded");
			this.resetSessionState();
			this.currentSessionId = null;
			return null;
		}

		const tracks = await this.writeTracks(sessionId);
		const utterances = await this.writeUtterances(sessionId);

		this.resetSessionState();
		this.currentSessionId = null;

		return tracks.length > 0 || utterances.length > 0
			? { tracks, utterances }
			: null;
	}

	private async join(channel: VoiceBasedChannel): Promise<void> {
		// 既存のゾンビ接続を先に破棄
		const existing = getVoiceConnection(channel.guild.id);
		if (existing) {
			console.log(
				`[VoiceManager] destroying existing connection (status=${existing.state.status})`,
			);
			existing.destroy();
		}

		this.guildId = channel.guild.id;
		console.log(
			`[VoiceManager] join: channelId=${channel.id} guildId=${channel.guild.id}`,
		);

		const connection = joinVoiceChannel({
			channelId: channel.id,
			guildId: channel.guild.id,
			adapterCreator: channel.guild.voiceAdapterCreator,
			selfDeaf: false,
		});

		connection.on("stateChange", (oldState, newState) => {
			console.log(
				`[VoiceManager] connection state: ${oldState.status} -> ${newState.status}`,
			);
		});

		connection.on("debug", (message) => {
			console.log(`[VoiceManager:debug] ${message}`);
		});

		connection.on(VoiceConnectionStatus.Disconnected, async () => {
			console.log(
				"[VoiceManager] connection disconnected — checking if reconnecting",
			);
			try {
				await Promise.race([
					entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
					entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
				]);
				console.log("[VoiceManager] reconnecting...");
			} catch {
				console.log(
					"[VoiceManager] could not reconnect, destroying connection",
				);
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
			console.error(
				"[VoiceManager] failed to reach Ready state, destroying connection",
			);
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
			console.log(
				`[VoiceManager] speaking start: userId=${userId} isRecording=${this._isRecording} alreadyActive=${this.activeStreams.has(userId)}`,
			);
			if (this.activeStreams.has(userId)) return;
			this.activeStreams.add(userId);
			this.activeUtterances.set(userId, {
				startedAtMs: Date.now(),
				chunks: [],
			});

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

			decoder.on("error", (error) => {
				console.error(`[VoiceManager] decoder error: userId=${userId}`, error);
				this.activeStreams.delete(userId);
				stream.destroy();
			});

			let chunkCount = 0;
			stream.pipe(decoder).on("data", (chunk: Buffer) => {
				chunkCount++;
				if (chunkCount === 1) {
					console.log(
						`[VoiceManager] first audio chunk from userId=${userId} isRecording=${this._isRecording}`,
					);
				}
				if (this._isRecording) {
					const userChunks = this.recordingChunks.get(userId) ?? [];
					userChunks.push(chunk);
					this.recordingChunks.set(userId, userChunks);

					const utterance = this.activeUtterances.get(userId);
					utterance?.chunks.push(chunk);
				} else {
					console.log(
						`[VoiceManager] chunk dropped (not recording) userId=${userId}`,
					);
				}
			});

			stream.on("end", () => {
				console.log(
					`[VoiceManager] stream end: userId=${userId} chunks=${chunkCount}`,
				);
				this.finalizeUtterance(userId, Date.now());
			});

			stream.on("error", (error) => {
				console.error(`[VoiceManager] stream error: userId=${userId}`, error);
				this.finalizeUtterance(userId, Date.now());
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

	private finalizeUtterance(userId: string, endedAtMs: number): void {
		this.activeStreams.delete(userId);
		const utterance = this.activeUtterances.get(userId);
		if (!utterance) {
			return;
		}

		this.activeUtterances.delete(userId);
		const durationMs = Math.max(0, endedAtMs - utterance.startedAtMs);
		if (
			utterance.chunks.length === 0 ||
			durationMs < MIN_UTTERANCE_DURATION_MS
		) {
			return;
		}

		this.completedUtterances.push({
			userId,
			startedAtMs: utterance.startedAtMs,
			endedAtMs,
			pcm: Buffer.concat(utterance.chunks),
		});
	}

	private async writeTracks(sessionId: string): Promise<UserTrack[]> {
		const tracks: UserTrack[] = [];
		for (const [userId, chunks] of this.recordingChunks) {
			const pcm = Buffer.concat(chunks);
			const oggPath = path.join(this.audioDir, `${sessionId}_${userId}.ogg`);
			await this.writeOggFile(`${sessionId}_${userId}`, pcm, oggPath);
			tracks.push({ userId, audioPath: oggPath });
		}
		return tracks;
	}

	private async writeUtterances(sessionId: string): Promise<UtteranceSegment[]> {
		const utterances: UtteranceSegment[] = [];
		for (const [index, utterance] of this.completedUtterances.entries()) {
			const baseName = `${sessionId}_utt_${String(index + 1).padStart(4, "0")}`;
			const oggPath = path.join(this.audioDir, `${baseName}.ogg`);
			await this.writeOggFile(baseName, utterance.pcm, oggPath);
			utterances.push({
				userId: utterance.userId,
				audioPath: oggPath,
				startedAtMs: utterance.startedAtMs,
				endedAtMs: utterance.endedAtMs,
			});
		}
		return utterances;
	}

	private async writeOggFile(
		baseName: string,
		pcm: Buffer,
		oggPath: string,
	): Promise<void> {
		const tmpPcm = path.join(os.tmpdir(), `${baseName}.pcm`);
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
	}

	private resetSessionState(): void {
		this.recordingChunks = new Map();
		this.activeUtterances = new Map();
		this.completedUtterances = [];
	}
}
