import * as fs from "node:fs";
import type { DatabaseService } from "@discord-meeting-note/database";

export function startCleanupScheduler(
	db: DatabaseService,
	intervalMs = 60 * 60 * 1000,
): void {
	const run = () => {
		const expired = db.getExpiredAudioSessions();
		for (const session of expired) {
			if (session.audioPath) {
				try {
					fs.unlinkSync(session.audioPath);
				} catch (err: unknown) {
					if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
						console.error(
							`Failed to delete audio file ${session.audioPath}:`,
							err,
						);
					}
				}
				db.clearAudioPath(session.id);
			}
		}
		if (expired.length > 0) {
			console.log(`Cleanup: deleted ${expired.length} expired audio file(s)`);
		}
	};

	run();
	setInterval(run, intervalMs);
}
