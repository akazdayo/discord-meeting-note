import { DatabaseService } from "@discord-meeting-note/database";
import type { LLMMessage, LLMResponse } from "@discord-meeting-note/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import { processSession } from "./pipeline.js";

describe("processSession", () => {
	let db: DatabaseService;

	beforeEach(() => {
		db = new DatabaseService(":memory:");
	});

	it("builds a chronological transcript from utterances", async () => {
		const session = db.createSession({
			guildId: "guild-1",
			channelId: "channel-1",
			requestedBy: "user-1",
		});
		db.updateSessionStatus(session.id, "processing");
		db.saveSessionUtterance({
			sessionId: session.id,
			userId: "user-2",
			audioPath: "/tmp/utt-2.ogg",
			startedAtMs: session.startedAt + 2_000,
			endedAtMs: session.startedAt + 2_500,
		});
		db.saveSessionUtterance({
			sessionId: session.id,
			userId: "user-1",
			audioPath: "/tmp/utt-1.ogg",
			startedAtMs: session.startedAt + 1_000,
			endedAtMs: session.startedAt + 1_500,
		});

		const transcriber = {
			transcribeFile: vi.fn(async (audioPath: string) => ({
				text:
					audioPath === "/tmp/utt-1.ogg" ? "first utterance" : "second utterance",
			})),
		};
		const llm = {
			complete: vi.fn(
				async (messages: LLMMessage[]): Promise<LLMResponse> => ({
					content: messages[1]?.content ?? "",
					model: "test-model",
				}),
			),
		};
		const send = vi.fn();
		const client = {
			guilds: {
				fetch: vi.fn().mockResolvedValue(null),
			},
			channels: {
				fetch: vi.fn().mockResolvedValue({
					isTextBased: () => true,
					isDMBased: () => false,
					send,
				}),
			},
		} as unknown as Client;

		await processSession(
			session.id,
			db,
			transcriber as never,
			llm as never,
			client,
		);

		expect(db.getTranscript(session.id)?.content).toBe(
			"[00:00:01] user-1: first utterance\n[00:00:02] user-2: second utterance",
		);
		expect(llm.complete).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledTimes(1);
		expect(db.getSession(session.id)?.status).toBe("done");
	});
});
