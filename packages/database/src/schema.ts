import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
	id: text("id").primaryKey(),
	guildId: text("guild_id").notNull(),
	channelId: text("channel_id").notNull(),
	requestedBy: text("requested_by").notNull(),
	status: text("status")
		.notNull()
		.$type<"recording" | "processing" | "done" | "failed">(),
	audioPath: text("audio_path"),
	startedAt: integer("started_at").notNull(),
	finishedAt: integer("finished_at"),
	expiresAt: integer("expires_at").notNull(),
});

export const transcripts = sqliteTable("transcripts", {
	id: text("id").primaryKey(),
	sessionId: text("session_id").notNull(),
	provider: text("provider").notNull(),
	content: text("content").notNull(),
	createdAt: integer("created_at").notNull(),
});

export const summaries = sqliteTable("summaries", {
	id: text("id").primaryKey(),
	sessionId: text("session_id").notNull(),
	provider: text("provider").notNull(),
	content: text("content").notNull(),
	createdAt: integer("created_at").notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type Transcript = typeof transcripts.$inferSelect;
export type Summary = typeof summaries.$inferSelect;
export type SessionStatus = "recording" | "processing" | "done" | "failed";
