import * as fs from "node:fs";
import type { DatabaseService } from "@discord-meeting-note/database";

export function startCleanupScheduler(
	db: DatabaseService,
	intervalMs = 60 * 60 * 1000,
): void {
	const run = () => {
		const expiredTracks = db.getExpiredTrackAudio();
		const expiredUtterances = db.getExpiredUtteranceAudio();

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

		for (const utterance of expiredUtterances) {
			if (utterance.audioPath) {
				try {
					fs.unlinkSync(utterance.audioPath);
				} catch (err: unknown) {
					if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
						console.error(
							`Failed to delete utterance audio file ${utterance.audioPath}:`,
							err,
						);
					}
				}
				db.clearUtteranceAudioPath(utterance.id);
			}
		}

		const deletedCount = expiredTracks.length + expiredUtterances.length;
		if (deletedCount > 0) {
			console.log(
				`Cleanup: deleted ${deletedCount} expired audio file(s)`,
			);
		}
	};

	run();
	setInterval(run, intervalMs);
}
