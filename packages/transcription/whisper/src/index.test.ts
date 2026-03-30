import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhisperTranscription } from "./index.js";

// Mock node:child_process so no real whisper CLI is invoked
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
		const outputDirIdx = args.indexOf("--output_dir");
		const outputDir = args[outputDirIdx + 1];
		const inputFile = args[0];
		const basename = path.basename(inputFile, path.extname(inputFile));
		const jsonPath = path.join(outputDir, `${basename}.json`);
		fs.writeFileSync(jsonPath, JSON.stringify({ text: whisperText, language }));
		callback(null, "", "");
		return {} as ReturnType<typeof childProcess.execFile>;
	};
}

describe("WhisperTranscription", () => {
	let whisper: WhisperTranscription;

	beforeEach(() => {
		vi.resetAllMocks();
		whisper = new WhisperTranscription();
	});

	afterEach(() => {
		delete process.env.WHISPER_MODEL;
	});

	describe("transcribeFile", () => {
		it("should parse whisper JSON output and return TranscriptionResult", async () => {
			mockedExecFile.mockImplementation(
				makeExecFileMock("  Hello, world!  ", "en"),
			);

			const result = await whisper.transcribeFile("/tmp/test-audio.ogg");

			expect(result.text).toBe("Hello, world!");
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
					callback(new Error("whisper not found"), "", "command not found");
					return {} as ReturnType<typeof childProcess.execFile>;
				},
			);

			await expect(whisper.transcribeFile("/tmp/audio.ogg")).rejects.toThrow(
				"Whisper transcription failed",
			);
		});

		it("should pass the correct model flag to whisper CLI", async () => {
			process.env.WHISPER_MODEL = "large";
			const w = new WhisperTranscription();

			let capturedArgs: string[] = [];
			mockedExecFile.mockImplementation(
				(
					_cmd: string,
					_args: readonly string[] | null | undefined,
					callback: ExecFileCallback,
				) => {
					capturedArgs = [...(_args ?? [])];
					const outputDirIdx = capturedArgs.indexOf("--output_dir");
					const outputDir = capturedArgs[outputDirIdx + 1];
					const basename = path.basename(
						capturedArgs[0],
						path.extname(capturedArgs[0]),
					);
					fs.writeFileSync(
						path.join(outputDir, `${basename}.json`),
						JSON.stringify({ text: "test" }),
					);
					callback(null, "", "");
					return {} as ReturnType<typeof childProcess.execFile>;
				},
			);

			await w.transcribeFile("/tmp/audio.ogg");
			expect(capturedArgs).toContain("large");
			expect(capturedArgs).toContain("--model");
		});
	});

	describe("transcribe (AudioBuffer)", () => {
		it("should write a WAV file and call transcribeFile", async () => {
			mockedExecFile.mockImplementation(
				makeExecFileMock("Audio buffer transcription", "ja"),
			);

			// 100ms of silence at 48kHz stereo 16-bit = 48000 * 2 * 2 * 0.1 = 19200 bytes
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
