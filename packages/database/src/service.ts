import BetterSqlite3 from "better-sqlite3";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ulid } from "ulid";
import type { Session, SessionStatus, Summary, Transcript } from "./schema.js";
import * as schema from "./schema.js";

export class DatabaseService {
	private readonly db: ReturnType<typeof drizzle>;

	constructor(dbPath: string) {
		const sqlite = new BetterSqlite3(dbPath);
		sqlite.pragma("journal_mode = WAL");
		this.db = drizzle(sqlite, { schema });
		this.migrate(sqlite);
	}

	private migrate(sqlite: BetterSqlite3.Database): void {
		sqlite.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				guild_id TEXT NOT NULL,
				channel_id TEXT NOT NULL,
				requested_by TEXT NOT NULL,
				status TEXT NOT NULL,
				audio_path TEXT,
				started_at INTEGER NOT NULL,
				finished_at INTEGER,
				expires_at INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS transcripts (
				id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				provider TEXT NOT NULL,
				content TEXT NOT NULL,
				created_at INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS summaries (
				id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				provider TEXT NOT NULL,
				content TEXT NOT NULL,
				created_at INTEGER NOT NULL
			);
		`);
	}

	createSession(data: {
		guildId: string;
		channelId: string;
		requestedBy: string;
	}): Session {
		const now = Date.now();
		const session: Session = {
			id: ulid(),
			guildId: data.guildId,
			channelId: data.channelId,
			requestedBy: data.requestedBy,
			status: "recording",
			audioPath: null,
			startedAt: now,
			finishedAt: null,
			expiresAt: now + 7 * 24 * 60 * 60 * 1000,
		};
		this.db.insert(schema.sessions).values(session).run();
		return session;
	}

	updateSessionStatus(
		id: string,
		status: SessionStatus,
		finishedAt?: number,
	): void {
		this.db
			.update(schema.sessions)
			.set({ status, finishedAt: finishedAt ?? null })
			.where(eq(schema.sessions.id, id))
			.run();
	}

	updateSessionAudioPath(id: string, audioPath: string | null): void {
		this.db
			.update(schema.sessions)
			.set({ audioPath })
			.where(eq(schema.sessions.id, id))
			.run();
	}

	getSession(id: string): Session | undefined {
		return this.db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
			.get();
	}

	saveTranscript(data: {
		sessionId: string;
		provider: string;
		content: string;
	}): void {
		this.db
			.insert(schema.transcripts)
			.values({
				id: ulid(),
				sessionId: data.sessionId,
				provider: data.provider,
				content: data.content,
				createdAt: Date.now(),
			})
			.run();
	}

	saveSummary(data: {
		sessionId: string;
		provider: string;
		content: string;
	}): void {
		this.db
			.insert(schema.summaries)
			.values({
				id: ulid(),
				sessionId: data.sessionId,
				provider: data.provider,
				content: data.content,
				createdAt: Date.now(),
			})
			.run();
	}

	getTranscript(sessionId: string): Transcript | undefined {
		return this.db
			.select()
			.from(schema.transcripts)
			.where(eq(schema.transcripts.sessionId, sessionId))
			.get();
	}

	getSummary(sessionId: string): Summary | undefined {
		return this.db
			.select()
			.from(schema.summaries)
			.where(eq(schema.summaries.sessionId, sessionId))
			.get();
	}

	getExpiredAudioSessions(): Session[] {
		return this.db
			.select()
			.from(schema.sessions)
			.where(
				and(
					lt(schema.sessions.expiresAt, Date.now()),
					isNotNull(schema.sessions.audioPath),
				),
			)
			.all();
	}

	clearAudioPath(id: string): void {
		this.db
			.update(schema.sessions)
			.set({ audioPath: null })
			.where(eq(schema.sessions.id, id))
			.run();
	}
}
