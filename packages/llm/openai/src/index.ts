import { LLMError } from "@discord-meeting-note/errors";
import type { LLMModel } from "@discord-meeting-note/llm-core";
import type { LLMMessage, LLMResponse } from "@discord-meeting-note/types";
import OpenAI from "openai";

export class OpenAILLM implements LLMModel {
	private readonly client: OpenAI;
	private readonly model: string;

	constructor() {
		this.client = new OpenAI({
			apiKey: process.env.OPENAI_API_KEY,
		});
		this.model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
	}

	async complete(messages: LLMMessage[]): Promise<LLMResponse> {
		try {
			const response = await this.client.chat.completions.create({
				model: this.model,
				messages,
			});

			const content = response.choices[0]?.message?.content ?? "";
			return {
				content,
				model: response.model,
				usage: response.usage
					? {
							promptTokens: response.usage.prompt_tokens,
							completionTokens: response.usage.completion_tokens,
						}
					: undefined,
			};
		} catch (err) {
			throw new LLMError("OpenAI completion failed", err);
		}
	}
}
