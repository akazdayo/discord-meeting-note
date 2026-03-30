import type { LLMMessage, LLMResponse } from "@discord-meeting-note/types";

export interface LLMModel {
	complete(messages: LLMMessage[]): Promise<LLMResponse>;
}
