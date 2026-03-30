import type { LLMModel } from "@discord-meeting-note/llm-core";
import type { LLMMessage, LLMResponse } from "@discord-meeting-note/types";

export class OllamaLLM implements LLMModel {
	async complete(_messages: LLMMessage[]): Promise<LLMResponse> {
		throw new Error("Not implemented");
	}
}
