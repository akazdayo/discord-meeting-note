export interface AudioBuffer {
	data: Buffer;
	sampleRate: number;
	channels: number;
	durationMs: number;
}

export interface TranscriptionResult {
	text: string;
	language?: string;
	confidence?: number;
}

export interface LLMMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface LLMResponse {
	content: string;
	model: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
	};
}
