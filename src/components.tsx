import { memo, useEffect, useState, type ReactNode } from "react";
import {
  ChevronLeft, Disc3, EllipsisVertical, Film, Heart, Info, ListEnd, ListPlus, ListStart, Music2, Pause, Play, Plus, Shuffle,
  SkipForward, Trash2, UserRound, X, type LucideIcon,
} from "lucide-react";
import { usePlayer, useProgress, type MenuTarget } from "./context";
import type { Track } from "./types";
import { albumKey, formatSize, formatTime } from "./util";

function hueOf(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

export function Art({ src, seed, icon: Icon = Music2, className = "", round = false }: { src?: string; seed: string; icon?: LucideIcon; className?: string; round?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const cls = `art ${round ? "round " : ""}${className}`;
  if (src && !failed) return <img className={cls} src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  const hue = hueOf(seed);
  return (
    <div className={cls + " placeholder"} style={{ background: `linear-gradient(135deg, hsl(${hue} 45% 26%), hsl(${(hue + 40) % 360} 40% 12%))` }}>
      <Icon />
    </div>
  );
}

export function NowBars({ paused }: { paused: boolean }) {
  return <span className={"nowBars" + (paused ? " paused" : "")} aria-label="Now playing"><i /><i /><i /></span>;
}

type RowProps = {
  track: Track;
  index: number;
  active: boolean;
  playing: boolean;
  favorite: boolean;
  number?: number | string;
  detail?: string;
  onPlay: (track: Track, index: number) => void;
  onMenu: (track: Track, index: number) => void;
  trailing?: ReactNode;
};

export const TrackRow = memo(function TrackRow({ track, index, active, playing, favorite, number, detail, onPlay, onMenu, trailing }: RowProps) {
  return (
    <div className={"trackRow" + (active ? " active" : "")} onClick={() => onPlay(track, index)} onContextMenu={(e) => { e.preventDefault(); onMenu(track, index); }}>
      {number != null ? (
        <span className="trackNo">{active ? <NowBars paused={!playing} /> : number}</span>
      ) : (
        <span className="thumb">
          <Art src={track.cover} seed={track.album || track.title} icon={track.kind === "video" ? Film : Music2} />
          {active && <span className="thumbOverlay"><NowBars paused={!playing} /></span>}
        </span>
      )}
      <div className="trackText">
        <b>{track.title}</b>
        <small>
          {favorite && <Heart className="favDot" size={11} fill="currentColor" />}
          {detail ?? ([track.artist, track.album].filter(Boolean).join(" · ") || (track.kind === "video" ? `Video · ${track.name.split(".").pop()?.toUpperCase()}` : track.folder || "Unknown artist"))}
        </small>
      </div>
      {trailing}
      <span className="trackDur">{track.duration ? formatTime(track.duration) : ""}</span>
      <button className="iconBtn" aria-label="More options" onClick={(e) => { e.stopPropagation(); onMenu(track, index); }}><EllipsisVertical size={18} /></button>
    </div>
  );
});

export function Sheet({ title, subtitle, cover, onClose, children }: { title: string; subtitle?: string; cover?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sheetBackdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheetHandle" />
        <header className="sheetHead">
          {cover}
          <div><b>{title}</b>{subtitle && <small>{subtitle}</small>}</div>
          <button className="iconBtn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>
        <div className="sheetBody">{children}</div>
      </div>
    </div>
  );
}

export function SheetItem({ icon: Icon, label, onClick, danger }: { icon: LucideIcon; label: string; onClick: () => void; danger?: boolean }) {
  return <button className={"sheetItem" + (danger ? " danger" : "")} onClick={onClick}><Icon size={20} /><span>{label}</span></button>;
}

export function TrackMenu({ target, onClose }: { target: MenuTarget; onClose: () => void }) {
  const { actions, favorites, playlists, plays, trackMap } = usePlayer();
  const [mode, setMode] = useState<"main" | "playlists" | "info">("main");
  const { ids, track } = target;
  const allFav = ids.length > 0 && ids.every((id) => favorites.has(id));
  const run = (fn: () => void) => () => { fn(); onClose(); };
  const cover = <Art src={target.cover ?? track?.cover} seed={target.title} icon={track?.kind === "video" ? Film : Music2} className="sheetCover" />;

  if (mode === "playlists") {
    return (
      <Sheet title="Add to playlist" subtitle={target.title} cover={cover} onClose={onClose}>
        <SheetItem icon={Plus} label="New playlist…" onClick={() => {
          const name = window.prompt("Playlist name", target.track ? "" : target.title)?.trim();
          if (!name) return;
          actions.createPlaylist(name, ids);
          onClose();
        }} />
        {playlists.map((p) => <SheetItem key={p.id} icon={ListPlus} label={`${p.name}  ·  ${p.trackIds.length}`} onClick={run(() => actions.addToPlaylist(p.id, ids))} />)}
      </Sheet>
    );
  }

  if (mode === "info" && track) {
    const rows: Array<[string, string | number | undefined]> = [
      ["Title", track.title], ["Artist", track.artist], ["Album", track.album], ["Album artist", track.albumArtist],
      ["Genre", track.genre], ["Year", track.year], ["Track", track.trackNo], ["Duration", track.duration ? formatTime(track.duration) : undefined],
      ["Plays", plays[track.id] ?? 0], ["File", track.name], ["Folder", track.folder || "—"], ["Size", formatSize(track.size)],
      ["Added", new Date(track.addedAt).toLocaleString()],
    ];
    return (
      <Sheet title="Track info" subtitle={track.title} cover={cover} onClose={onClose}>
        <dl className="infoList">{rows.filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </Sheet>
    );
  }

  return (
    <Sheet title={target.title} subtitle={target.subtitle} cover={cover} onClose={onClose}>
      <SheetItem icon={Play} label="Play" onClick={run(() => actions.playTracks(ids, undefined, { shuffle: false, source: target.title }))} />
      {ids.length > 1 && <SheetItem icon={Shuffle} label="Shuffle play" onClick={run(() => actions.playTracks(ids, undefined, { shuffle: true, source: target.title }))} />}
      <SheetItem icon={ListStart} label="Play next" onClick={run(() => actions.playNext(ids))} />
      <SheetItem icon={ListEnd} label="Add to queue" onClick={run(() => actions.addToQueue(ids))} />
      <SheetItem icon={ListPlus} label="Add to playlist…" onClick={() => setMode("playlists")} />
      <SheetItem icon={Heart} label={allFav ? "Remove from favorites" : "Add to favorites"} onClick={run(() => actions.toggleFavorite(ids))} />
      {track?.artist && <SheetItem icon={UserRound} label={`Go to artist: ${track.artist}`} onClick={() => actions.navigate({ view: "artist", name: track.artist })} />}
      {track && track.kind === "audio" && <SheetItem icon={Disc3} label="Go to album" onClick={() => actions.navigate({ view: "album", key: albumKey(track) })} />}
      {target.queueIndex != null && <SheetItem icon={X} label="Remove from queue" onClick={run(() => actions.removeFromQueue(target.queueIndex!))} />}
      {target.playlist && <SheetItem icon={X} label="Remove from this playlist" onClick={run(() => actions.removeFromPlaylist(target.playlist!.id, target.playlist!.index))} />}
      {track && <SheetItem icon={Info} label="Track info" onClick={() => setMode("info")} />}
      <SheetItem icon={Trash2} danger label={ids.length > 1 ? `Remove ${ids.length} items from library` : "Remove from library"} onClick={() => {
        const valid = ids.filter((id) => trackMap.has(id));
        if (!valid.length) return onClose();
        if (!window.confirm(valid.length > 1 ? `Remove ${valid.length} items from your library? The original files are not touched.` : `Remove “${target.title}” from your library? The original file is not touched.`)) return;
        actions.removeFromLibrary(valid);
        onClose();
      }} />
    </Sheet>
  );
}

export function MiniPlayer() {
  const { current, playing, actions } = usePlayer();
  const { currentTime, duration } = useProgress();
  if (!current) return null;
  return (
    <div className="miniPlayer" onClick={() => actions.goTo("player")}>
      <i className="miniProgress" style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }} />
      <Art src={current.cover} seed={current.album || current.title} icon={current.kind === "video" ? Film : Music2} className="miniArt" />
      <div className="miniText">
        <b>{current.title}</b>
        <small>{current.artist || current.album || (current.kind === "video" ? "Video" : "Unknown artist")}</small>
      </div>
      <button className="iconBtn big" aria-label={playing ? "Pause" : "Play"} onClick={(e) => { e.stopPropagation(); actions.togglePlay(); }}>
        {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
      </button>
      <button className="iconBtn" aria-label="Next" onClick={(e) => { e.stopPropagation(); actions.next(); }}><SkipForward fill="currentColor" /></button>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={"toggle" + (checked ? " on" : "")} onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

export function ScreenHeader({ title, subtitle, onBack, children }: { title: string; subtitle?: string; onBack?: () => void; children?: ReactNode }) {
  return (
    <header className="screenHeader">
      {onBack && <button className="iconBtn" aria-label="Back" onClick={onBack}><ChevronLeft size={24} /></button>}
      <div className="screenTitle"><h1>{title}</h1>{subtitle && <small>{subtitle}</small>}</div>
      <div className="screenActions">{children}</div>
    </header>
  );
}

