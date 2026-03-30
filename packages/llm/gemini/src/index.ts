import type { LLMMessage, LLMResponse } from "@discord-meeting-note/types";
import type { LLMModel } from "@discord-meeting-note/llm-core";

export class GeminiLLM implements LLMModel {
	async complete(_messages: LLMMessage[]): Promise<LLMResponse> {
		throw new Error("Not implemented");
	}
}
