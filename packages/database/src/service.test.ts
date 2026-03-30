import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseService } from "./service.js";

describe("DatabaseService", () => {
	let db: DatabaseService;

	beforeEach(() => {
		// Use in-memory SQLite for each test
		db = new DatabaseService(":memory:");
	});

	afterEach(() => {
		// Nothing to clean up; in-memory DB is discarded
	});

	describe("createSession", () => {
		it("should create a session with recording status", () => {
			const session = db.createSession({
				guildId: "guild-1",
				channelId: "channel-1",
				requestedBy: "user-1",
			});

			expect(session.id).toBeTruthy();
			expect(session.guildId).toBe("guild-1");
			expect(session.channelId).toBe("channel-1");
			expect(session.requestedBy).toBe("user-1");
			expect(session.status).toBe("recording");
			expect(session.finishedAt).toBeNull();
			expect(session.startedAt).toBeGreaterThan(0);
			expect(session.expiresAt).toBe(
				session.startedAt + 7 * 24 * 60 * 60 * 1000,
			);
		});

		it("should generate unique IDs for each session", () => {
			const s1 = db.createSession({
				guildId: "g",
				channelId: "c",
				requestedBy: "u",
			});
			const s2 = db.createSession({
				guildId: "g",
				channelId: "c",
				requestedBy: "u",
			});
			expect(s1.id).not.toBe(s2.id);
		});
	});

	describe("getSession", () => {
		it("should return the session by ID", () => {
			const created = db.createSession({
				guildId: "g",
				channelId: "c",
				requestedBy: "u",
			});
			const fetched = db.getSession(created.id);
			expect(fetched).toBeDefined();
			expect(fetched?.id).toBe(created.id);
		});

		it("should return undefined for unknown ID", () => {
			expect(db.getSession("nonexistent")).toBeUndefined();
		});
	});

	describe("updateSessionStatus", () => {
		it("should update status to processing", () => {
			const session = db.createSession({
				guildId: "g",
				channelId: "c",
				requestedBy: "u",
			});
			db.updateSessionStatus(session.id, "processing");
			expect(db.getSession(session.id)?.status).toBe("processing");
		});

		it("should update status to done with finishedAt", () => {
			const session = db.createSession({
				guildId: "g",
				channelId: "c",
				requestedBy: "u",
			});
			const finishedAt = Date.now();
			db.updateSessionStatus(session.id, "done", finishedAt);
			const updated = db.getSession(session.id);
			expect(updated?.status).toBe("done");
			expect(updated?.finishedAt).toBe(finishedAt);
		});

		it("should update status to failed", () => {
			const session = db.createSession({
				guildId: "g",
				channelId: "c",
				requestedBy: "u",
			});
			db.updateSessionStatus(session.id, "failed");
			expect(db.getSession(session.id)?.status).toBe("failed");
		});
	});

	describe("saveSessionTrack / getSessionTracks", () => {
		it("should save and retrieve tracks for a session", () => {
			const session = db.createSession({
				guildId: "g",
				channelId: "c",
				requestedBy: "u",
			});
			db.saveSessionTrack({
				sessionId: session.id,
				userId: "user-1",
				audioPath: "/data/audio/session_user-1.ogg",
			});
			db.saveSessionTrack({
				sessionId: session.id,
				userId: "user-2",
				audioPath: "/data/audio/session_user-2.ogg",
			});

			const tracks = db.getSessionTracks(session.id);
			expect(tracks).toHaveLength(2);
			expect(tracks.map((t) => t.userId)).toContain("user-1");
			expect(tracks.map((t) => t.userId)).toContain("user-2");
		});

		it("should return empty array when no tracks exist", () => {
			expect(db.getSessionTracks("no-such-session")).toHaveLength(0);
		});
	});

	describe("saveSessionUtterance / getSessionUtterances", () => {
		it("should save and retrieve utterances in chronological order", () => {
			const session = db.createSession({
				guildId: "g",
				channelId: "c",
				requestedBy: "u",
			});
			db.saveSessionUtterance({
				sessionId: session.id,
				userId: "user-2",
				audioPath: "/data/audio/utt-2.ogg",
				startedAtMs: 2_000,
				endedAtMs: 2_500,
			});
			db.saveSessionUtterance({
				sessionId: session.id,
				userId: "user-1",
				audioPath: "/data/audio/utt-1.ogg",
				startedAtMs: 1_000,
				endedAtMs: 1_500,
			});

			const utterances = db.getSessionUtterances(session.id);
			expect(utterances).toHaveLength(2);
			expect(utterances.map((u) => u.userId)).toEqual(["user-1", "user-2"]);
		});

		it("should return empty array when no utterances exist", () => {
			expect(db.getSessionUtterances("no-such-session")).toHaveLength(0);
		});
	});

	describe("saveTranscript / getTranscript", () => {
		it("should save and retrieve a transcript", () => {
			const session = db.createSession({
				guildId: "g",
				channelId: "c",
				requestedBy: "u",
			});
			db.saveTranscript({
				sessionId: session.id,
				provider: "whisper",
				content: "Hello world",
			});

			const transcript = db.getTranscript(session.id);
			expect(transcript).toBeDefined();
			expect(transcript?.content).toBe("Hello world");
			expect(transcript?.provider).toBe("whisper");
			expect(transcript?.sessionId).toBe(session.id);
		});

		it("should return undefined when no transcript exists", () => {
			expect(db.getTranscript("no-such-session")).toBeUndefined();
		});
	});

	describe("saveSummary / getSummary", () => {
		it("should save and retrieve a summary", () => {
			const session = db.createSession({
				guildId: "g",
				channelId: "c",
				requestedBy: "u",
			});
			db.saveSummary({
				sessionId: session.id,
				provider: "openai",
				content: "## Summary\n...",
			});

			const summary = db.getSummary(session.id);
			expect(summary).toBeDefined();
			expect(summary?.content).toBe("## Summary\n...");
			expect(summary?.provider).toBe("openai");
		});

		it("should return undefined when no summary exists", () => {
			expect(db.getSummary("no-such-session")).toBeUndefined();
		});
	});

	describe("getExpiredTrackAudio", () => {
		it("should return no tracks when none are expired", () => {
			const session = db.createSession({
				guildId: "g",
				channelId: "c",
				requestedBy: "u",
			});
			db.saveSessionTrack({
				sessionId: session.id,
				userId: "user-1",
				audioPath: "/data/audio/test.ogg",
			});
			// expiresAt is 7 days in the future, so nothing should be expired
			expect(db.getExpiredTrackAudio()).toHaveLength(0);
		});

		it("should return no tracks when audioPath is null", () => {
			db.createSession({ guildId: "g", channelId: "c", requestedBy: "u" });
			expect(db.getExpiredTrackAudio()).toHaveLength(0);
		});
	});

	describe("clearTrackAudioPath", () => {
		it("should set audio_path to null", () => {
			const session = db.createSession({
				guildId: "g",
				channelId: "c",
				requestedBy: "u",
			});
			db.saveSessionTrack({
				sessionId: session.id,
				userId: "user-1",
				audioPath: "/data/audio/test.ogg",
			});
			const [track] = db.getSessionTracks(session.id);
			db.clearTrackAudioPath(track.id);
			const [updated] = db.getSessionTracks(session.id);
			expect(updated.audioPath).toBeNull();
		});
	});

	describe("clearUtteranceAudioPath", () => {
		it("should set utterance audio_path to null", () => {
			const session = db.createSession({
				guildId: "g",
				channelId: "c",
				requestedBy: "u",
			});
			db.saveSessionUtterance({
				sessionId: session.id,
				userId: "user-1",
				audioPath: "/data/audio/utt.ogg",
				startedAtMs: 1_000,
				endedAtMs: 1_500,
			});
			const [utterance] = db.getSessionUtterances(session.id);
			db.clearUtteranceAudioPath(utterance.id);
			const [updated] = db.getSessionUtterances(session.id);
			expect(updated.audioPath).toBeNull();
		});
	});
});
