import * as fs from "node:fs";
import type { DatabaseService } from "@discord-meeting-note/database";

export function startCleanupScheduler(
	db: DatabaseService,
	intervalMs = 60 * 60 * 1000,
): void {
	const run = () => {
		const expiredTracks = db.getExpiredTrackAudio();
		for (const track of expiredTracks) {
			if (track.audioPath) {
				try {
					fs.unlinkSync(track.audioPath);
				} catch (err: unknown) {
					if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
						console.error(
							`Failed to delete audio file ${track.audioPath}:`,
							err,
						);
					}
				}
				db.clearTrackAudioPath(track.id);
			}
		}
		if (expiredTracks.length > 0) {
			console.log(
				`Cleanup: deleted ${expiredTracks.length} expired audio track file(s)`,
			);
		}
	};

	run();
	setInterval(run, intervalMs);
}
