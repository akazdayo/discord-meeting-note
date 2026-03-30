import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MlxWhisperTranscription } from "./index.js";

vi.mock("node:child_process", async (importOriginal) => {
	const original = await importOriginal<typeof childProcess>();
	return { ...original, execFile: vi.fn() };
});

type ExecFileCallback = (
	error: Error | null,
	stdout: string,
	stderr: string,
) => void;

const mockedExecFile = vi.mocked(childProcess.execFile);

function makeExecFileMock(whisperText: string, language?: string) {
	return (
		_cmd: string,
		_args: readonly string[] | null | undefined,
		callback: ExecFileCallback,
	) => {
		const args = (_args ?? []) as string[];
		const outputDirIdx = args.indexOf("--output-dir");
		const outputDir = args[outputDirIdx + 1];
		const outputNameIdx = args.indexOf("--output-name");
		const outputName =
			outputNameIdx >= 0
				? args[outputNameIdx + 1]
				: path.basename(args[0], path.extname(args[0]));
		const jsonPath = path.join(outputDir, `${outputName}.json`);
		fs.writeFileSync(jsonPath, JSON.stringify({ text: whisperText, language }));
		callback(null, "", "");
		return {} as ReturnType<typeof childProcess.execFile>;
	};
}

describe("MlxWhisperTranscription", () => {
	let whisper: MlxWhisperTranscription;

	beforeEach(() => {
		vi.resetAllMocks();
		delete process.env.MLX_WHISPER_CMD;
		delete process.env.MLX_WHISPER_MODEL;
		delete process.env.MLX_WHISPER_LANGUAGE;
		whisper = new MlxWhisperTranscription();
	});

	afterEach(() => {
		delete process.env.MLX_WHISPER_CMD;
		delete process.env.MLX_WHISPER_MODEL;
		delete process.env.MLX_WHISPER_LANGUAGE;
	});

	describe("transcribeFile", () => {
		it("should parse mlx_whisper JSON output and return TranscriptionResult", async () => {
			mockedExecFile.mockImplementation(
				makeExecFileMock("  Hello, from MLX Whisper!  ", "en"),
			);

			const result = await whisper.transcribeFile("/tmp/test-audio.ogg");

			expect(result.text).toBe("Hello, from MLX Whisper!");
			expect(result.language).toBe("en");
		});

		it("should trim whitespace from transcribed text", async () => {
			mockedExecFile.mockImplementation(
				makeExecFileMock("\n\n lots of whitespace \n\n"),
			);

			const result = await whisper.transcribeFile("/tmp/audio.ogg");
			expect(result.text).toBe("lots of whitespace");
		});

		it("should throw TranscriptionError when execFile fails", async () => {
			mockedExecFile.mockImplementation(
				(
					_cmd: string,
					_args: readonly string[] | null | undefined,
					callback: ExecFileCallback,
				) => {
					callback(new Error("mlx_whisper not found"), "", "command not found");
					return {} as ReturnType<typeof childProcess.execFile>;
				},
			);

			await expect(whisper.transcribeFile("/tmp/audio.ogg")).rejects.toThrow(
				"MLX Whisper transcription failed",
			);
		});

		it("should pass the correct model flag to mlx_whisper CLI", async () => {
			process.env.MLX_WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo";
			const w = new MlxWhisperTranscription();

			let capturedArgs: string[] = [];
			mockedExecFile.mockImplementation(
				(
					_cmd: string,
					_args: readonly string[] | null | undefined,
					callback: ExecFileCallback,
				) => {
					capturedArgs = [...(_args ?? [])];
					const outputDirIdx = capturedArgs.indexOf("--output-dir");
					const outputDir = capturedArgs[outputDirIdx + 1];
					const outputNameIdx = capturedArgs.indexOf("--output-name");
					const outputName = capturedArgs[outputNameIdx + 1];
					fs.writeFileSync(
						path.join(outputDir, `${outputName}.json`),
						JSON.stringify({ text: "test" }),
					);
					callback(null, "", "");
					return {} as ReturnType<typeof childProcess.execFile>;
				},
			);

			await w.transcribeFile("/tmp/audio.ogg");
			expect(capturedArgs).toContain("--model");
			expect(capturedArgs).toContain("mlx-community/whisper-large-v3-turbo");
		});

		it("should pass the language flag when configured", async () => {
			process.env.MLX_WHISPER_LANGUAGE = "ja";
			const w = new MlxWhisperTranscription();

			let capturedArgs: string[] = [];
			mockedExecFile.mockImplementation(
				(
					_cmd: string,
					_args: readonly string[] | null | undefined,
					callback: ExecFileCallback,
				) => {
					capturedArgs = [...(_args ?? [])];
					const outputDirIdx = capturedArgs.indexOf("--output-dir");
					const outputDir = capturedArgs[outputDirIdx + 1];
					const outputNameIdx = capturedArgs.indexOf("--output-name");
					const outputName = capturedArgs[outputNameIdx + 1];
					fs.writeFileSync(
						path.join(outputDir, `${outputName}.json`),
						JSON.stringify({ text: "test", language: "ja" }),
					);
					callback(null, "", "");
					return {} as ReturnType<typeof childProcess.execFile>;
				},
			);

			await w.transcribeFile("/tmp/audio.ogg");
			expect(capturedArgs).toContain("--language");
			expect(capturedArgs).toContain("ja");
		});
	});

	describe("transcribe (AudioBuffer)", () => {
		it("should write a WAV file and call transcribeFile", async () => {
			mockedExecFile.mockImplementation(
				makeExecFileMock("Audio buffer transcription", "ja"),
			);

			const silentPcm = Buffer.alloc(19200, 0);
			const result = await whisper.transcribe({
				data: silentPcm,
				sampleRate: 48000,
				channels: 2,
				durationMs: 100,
			});

			expect(result.text).toBe("Audio buffer transcription");
			expect(result.language).toBe("ja");
		});
	});
});
