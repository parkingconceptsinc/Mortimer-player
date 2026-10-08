import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, Download, FilePlus, FolderOpen, HardDrive, Keyboard, ListMusic, SlidersHorizontal, Trash2 } from "lucide-react";
import { usePlayer } from "../context";
import { ScreenHeader, Toggle } from "../components";
import type { VideoFit } from "../types";
import { ACCENTS, formatSize } from "../util";

const SHORTCUTS: Array<[string, string]> = [
  ["Space / K", "Play / pause"], ["← / J", "Skip back"], ["→ / L", "Skip forward"], ["↑ / ↓", "Volume"],
  ["N / P", "Next / previous"], ["M", "Mute"], ["S", "Shuffle"], ["R", "Repeat mode"], ["[ / ] / =", "Slower / faster / normal speed"], ["F", "Video fullscreen"],
];

export function Settings() {
  const p = usePlayer();
  const { actions } = p;
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const musicVideoSize = p.tracks.reduce((sum, t) => sum + t.size, 0);
  const booksComicsSize = p.comics.reduce((sum, c) => sum + c.size, 0);
  const librarySize = musicVideoSize + booksComicsSize;

  const refreshStorage = () => {
    void Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()])
      .then(([estimate, persisted]) => setStorage({ usage: estimate?.usage, quota: estimate?.quota, persisted }))
      .catch(() => {});
  };
  useEffect(refreshStorage, [p.tracks.length]);

  return (
    <section className="screen settingsScreen">
      <ScreenHeader title="Settings" />

      <Card title="Audio">
        <button className="settingLink" onClick={() => actions.goTo("eq")}>
          <SlidersHorizontal size={20} /><span>Equalizer<small>{p.eq.enabled ? p.eq.preset : "Off"}{p.boost !== 1 ? ` · boost ${Math.round(p.boost * 100)}%` : ""}</small></span><ChevronRight size={18} />
        </button>
        <button className="settingLink" onClick={() => actions.goTo("queue")}>
          <ListMusic size={20} /><span>Queue<small>{p.queue.length ? `${p.queue.length} tracks` : "Empty"}</small></span><ChevronRight size={18} />
        </button>
      </Card>

      <Card title="Playback">
        <Row label="Skip interval" hint="Used by the ±buttons, double-tap on video, keyboard and lock screen">
          <Chips values={[5, 10, 15, 30, 60]} current={p.skipSeconds} format={(v) => `${v}s`} onPick={actions.setSkipSeconds} />
        </Row>
        <Row label="Playback speed" hint={`${p.speed}× ${p.speed !== 1 ? "(applies to everything you play)" : ""}`}>
          <Chips values={[0.75, 1, 1.25, 1.5, 2]} current={p.speed} format={(v) => `${v}×`} onPick={actions.setSpeed} />
        </Row>
        <Row label="Keep pitch when changing speed"><Toggle checked={p.preservePitch} onChange={actions.setPreservePitch} label="Keep pitch" /></Row>
        <Row label="Resume where you left off" hint="Reopens the last track at the same position"><Toggle checked={p.resumePosition} onChange={actions.setResumePosition} label="Resume position" /></Row>
        <Row label="Show remaining time"><Toggle checked={p.showRemaining} onChange={actions.setShowRemaining} label="Show remaining time" /></Row>
      </Card>

      <Card title="Video">
        <Row label="Video scaling">
          <Chips values={["contain", "cover", "fill"] as VideoFit[]} current={p.videoFit} format={(v) => ({ contain: "Fit", cover: "Fill", fill: "Stretch" })[v]} onPick={actions.setVideoFit} />
        </Row>
        <Row label="Subtitle size" hint="Load .srt or .vtt subtitles from the player while a video plays">
          <Chips values={[75, 100, 125, 150, 200]} current={p.subtitleSize} format={(v) => `${v}%`} onPick={actions.setSubtitleSize} />
        </Row>
      </Card>

      <Card title="Appearance">
        <Row label="Accent color">
          <div className="swatches">
            {Object.entries(ACCENTS).map(([name, color]) => (
              <button key={name} className={"swatch" + (p.accent === name ? " on" : "")} style={{ background: color }} aria-label={name} title={name} onClick={() => actions.setAccent(name)} />
            ))}
          </div>
        </Row>
      </Card>

      <Card title="Library">
        <div className="buttonRow">
          <button className="btn" onClick={actions.importFolder}><FolderOpen size={17} /> Add folder</button>
          <button className="btn" onClick={actions.importFiles}><FilePlus size={17} /> Add files</button>
        </div>
        <Row label={`${p.tracks.length} media · ${p.comics.length} books/comics · ${formatSize(librarySize)}`} hint={storage.quota ? `Using ${formatSize(storage.usage ?? 0)} of ${formatSize(storage.quota)} available to this app` : undefined}>
          <HardDrive size={20} className="muted" />
        </Row>
        <Row label="Protect library from automatic cleanup" hint={storage.persisted ? "Granted — the browser won't evict your library" : "Asks the browser to keep your files even when space runs low"}>
          {storage.persisted ? <span className="badge">On</span> : (
            <button className="btn small" onClick={() => {
              void navigator.storage?.persist?.().then((ok) => {
                actions.toast(ok ? "Library storage is now persistent" : "The browser declined — installing the app usually helps");
                refreshStorage();
              });
            }}>Enable</button>
          )}
        </Row>
        <button className="btn danger wide" disabled={!p.tracks.length && !p.comics.length} onClick={() => {
          if (window.confirm("Remove all music, videos, books and comics from the app? Your original files are not touched.")) actions.clearLibrary();
        }}><Trash2 size={16} /> Clear library</button>
      </Card>

      <Card title="App">
        {p.canInstall && <button className="btn primary wide" onClick={actions.install}><Download size={17} /> Install app</button>}
        <details className="shortcuts">
          <summary><Keyboard size={17} /> Keyboard shortcuts</summary>
          <dl>{SHORTCUTS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </details>
        <p className="hint">Everything stays on this device. Swipe the album art to change tracks; double-tap the left or right of a video to skip.</p>
      </Card>
    </section>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <div className="card"><h2 className="sectionLabel">{title}</h2>{children}</div>;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settingRow">
      <div><span>{label}</span>{hint && <small>{hint}</small>}</div>
      <div className="settingControl">{children}</div>
    </div>
  );
}

function Chips<T extends string | number>({ values, current, format, onPick }: { values: T[]; current: T; format: (v: T) => string; onPick: (v: T) => void }) {
  return (
    <div className="chips compact">
      {values.map((v) => <button key={String(v)} className={"chip" + (v === current ? " on" : "")} onClick={() => onPick(v)}>{format(v)}</button>)}
    </div>
  );
}
