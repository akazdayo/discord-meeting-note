import type { TranscriptionModel } from "@discord-meeting-note/transcription-core";
import type {
	AudioBuffer,
	TranscriptionResult,
} from "@discord-meeting-note/types";

export class GoogleSTTTranscription implements TranscriptionModel {
	async transcribe(_audio: AudioBuffer): Promise<TranscriptionResult> {
		throw new Error("Not implemented");
	}
}
