import type { AudioBuffer, TranscriptionResult } from "@discord-meeting-note/types";

export interface TranscriptionModel {
	transcribe(audio: AudioBuffer): Promise<TranscriptionResult>;
}
