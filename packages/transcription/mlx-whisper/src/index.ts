import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { TranscriptionError } from "@discord-meeting-note/errors";
import type { TranscriptionModel } from "@discord-meeting-note/transcription-core";
import type {
  AudioBuffer,
  TranscriptionResult,
} from "@discord-meeting-note/types";

const execFileAsync = promisify(execFile);

interface MlxWhisperJsonOutput {
  text: string;
  language?: string;
}

export class MlxWhisperTranscription implements TranscriptionModel {
  private readonly model: string;
  private readonly cmd: string;
  private readonly language?: string;

  constructor() {
    this.model =
      process.env.MLX_WHISPER_MODEL ?? "mlx-community/whisper-medium-mlx";
    this.cmd = process.env.MLX_WHISPER_CMD ?? "mlx_whisper";
    this.language = process.env.MLX_WHISPER_LANGUAGE?.trim() || undefined;
  }

  async transcribeFile(filePath: string): Promise<TranscriptionResult> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlx-whisper-"));
    const outputName = path.basename(filePath, path.extname(filePath));
    const args = [
      filePath,
      "--model",
      this.model,
      "--output-dir",
      tmpDir,
      "--output-name",
      outputName,
      "--output-format",
      "json",
    ];

    if (this.language) {
      args.push("--language", this.language);
    }

    try {
      await execFileAsync(this.cmd, args);

      const jsonPath = path.join(tmpDir, `${outputName}.json`);
      const raw = fs.readFileSync(jsonPath, "utf-8");
      const output: MlxWhisperJsonOutput = JSON.parse(raw);

      return {
        text: output.text.trim(),
        language: output.language,
      };
    } catch (err) {
      throw new TranscriptionError("MLX Whisper transcription failed", err);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  async transcribe(audio: AudioBuffer): Promise<TranscriptionResult> {
    const tmpFile = path.join(
      os.tmpdir(),
      `mlx-whisper-input-${Date.now()}.wav`,
    );

    try {
      const wavBuffer = pcmToWav(audio.data, audio.sampleRate, audio.channels);
      fs.writeFileSync(tmpFile, wavBuffer);
      return await this.transcribeFile(tmpFile);
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  }
}

function pcmToWav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}
