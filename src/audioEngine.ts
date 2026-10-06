export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_RANGE = 12;

export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "Bass Boost": [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  "Bass Reducer": [-6, -5, -4, -2, -1, 0, 0, 0, 0, 0],
  "Treble Boost": [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
  Rock: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5],
  Pop: [-1, 1, 3, 4, 3, 1, 0, -1, -1, -1],
  Jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  Classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  "Hip-Hop": [6, 5, 2, 3, -1, -1, 1, 0, 2, 3],
  Electronic: [5, 4, 1, 0, -2, 2, 1, 1, 4, 5],
  Dance: [4, 6, 4, 0, 0, -2, -2, -2, 0, 0],
  Latin: [3, 2, 0, 0, -1, -1, -1, 0, 3, 4],
  Reggaeton: [6, 5, 3, 0, -1, 0, 1, 2, 3, 3],
  Vocal: [-2, -3, -2, 1, 4, 4, 3, 1, 0, -2],
  Acoustic: [4, 4, 3, 1, 2, 1, 3, 3, 3, 2],
  Loudness: [6, 4, 0, 0, -2, 0, -1, -5, 5, 1],
  Headphones: [4, 6, 3, -1, -2, 1, 3, 6, 7, 7],
  "Small Speakers": [-4, -2, 0, 3, 4, 4, 3, 2, 1, 0],
};

type Graph = {
  ctx: AudioContext;
  preamp: GainNode;
  filters: BiquadFilterNode[];
  panner: StereoPannerNode;
};

let graph: Graph | null = null;
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

export function initEngine(): boolean {
  if (graph) return true;
  const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return false;
  const ctx = new Ctor();
  const preamp = ctx.createGain();
  const filters = EQ_BANDS.map((frequency, i) => {
    const filter = ctx.createBiquadFilter();
    filter.type = i === 0 ? "lowshelf" : i === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
    filter.frequency.value = frequency;
    filter.Q.value = 1.1;
    filter.gain.value = 0;
    return filter;
  });
  const panner = ctx.createStereoPanner();
  // Keeps boosted EQ/volume from clipping; only bites near 0 dBFS.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;

  preamp.connect(filters[0]);
  filters.reduce((prev, next) => { prev.connect(next); return next; });
  filters[filters.length - 1].connect(panner);
  panner.connect(limiter);
  limiter.connect(ctx.destination);
  graph = { ctx, preamp, filters, panner };
  return true;
}

export function attachElement(el: HTMLMediaElement | null) {
  if (!graph || !el || sources.has(el)) return;
  try {
    const source = graph.ctx.createMediaElementSource(el);
    source.connect(graph.preamp);
    sources.set(el, source);
  } catch {}
}

export function resumeEngine() {
  if (graph && graph.ctx.state !== "running") void graph.ctx.resume().catch(() => {});
}

export function applyAudio(options: { enabled: boolean; bands: number[]; preamp: number; balance: number; boost: number }) {
  if (!graph) return;
  const now = graph.ctx.currentTime;
  graph.filters.forEach((filter, i) => filter.gain.setTargetAtTime(options.enabled ? options.bands[i] ?? 0 : 0, now, 0.03));
  const preampDb = options.enabled ? options.preamp : 0;
  graph.preamp.gain.setTargetAtTime(Math.pow(10, preampDb / 20) * options.boost, now, 0.03);
  graph.panner.pan.setTargetAtTime(options.balance, now, 0.03);
}
