import type { AudioBuffer, TranscriptionResult } from "@discord-meeting-note/types";
import type { TranscriptionModel } from "@discord-meeting-note/transcription-core";

export class WhisperTranscription implements TranscriptionModel {
	async transcribe(_audio: AudioBuffer): Promise<TranscriptionResult> {
		throw new Error("Not implemented");
	}
}
