import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let sequence = 0;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.then(() => undefined, () => undefined);
  return next;
}

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg?.loaded) return ffmpeg;
  loading ??= (async () => {
    const instance = ffmpeg ?? new FFmpeg();
    ffmpeg = instance;
    const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
    await instance.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    });
    return instance;
  })().catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

export type DecodedAudio = { context: AudioContext; buffer: AudioBuffer };

export async function decodeAudioTrack(source: Blob): Promise<DecodedAudio> {
  return enqueue(async () => {
    const engine = await getFFmpeg();
    const id = ++sequence;
    const input = `mortimer-audio-input-${id}`;
    const output = `mortimer-audio-output-${id}.pcm`;
    try {
      await engine.writeFile(input, await fetchFile(source));
      const code = await engine.exec([
        "-i", input,
        "-map", "0:a:0",
        "-vn",
        "-ac", "2",
        "-ar", "48000",
        "-f", "f32le",
        "-y", output,
      ]);
      if (code !== 0) throw new Error("Audio decoder failed");
      const data = await engine.readFile(output);
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      if (!bytes.byteLength || bytes.byteLength % 8 !== 0) throw new Error("Decoded audio is empty");
      const pcmBytes = new Uint8Array(bytes.byteLength);
      pcmBytes.set(bytes);
      const interleaved = new Float32Array(pcmBytes.buffer);
      if (interleaved.length % 2 !== 0) throw new Error("Invalid stereo PCM");
      const frames = interleaved.length / 2;
      const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error("Web Audio is unavailable");
      const context = new Ctor({ sampleRate: 48000 });
      const buffer = context.createBuffer(2, frames, 48000);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      for (let i = 0, frame = 0; frame < frames; frame++, i += 2) {
        left[frame] = interleaved[i];
        right[frame] = interleaved[i + 1];
      }
      return { context, buffer };
    } finally {
      await engine.deleteFile(input).catch(() => {});
      await engine.deleteFile(output).catch(() => {});
    }
  });
}
