import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Captions, ChevronDown, Disc3, EllipsisVertical, Film, Gauge, Heart, Maximize, Music2, Pause, PictureInPicture2, Play,
  Repeat, Repeat1, RotateCcw, RotateCw, Scaling, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Timer, Volume1,
  Volume2, VolumeX, type LucideIcon,
} from "lucide-react";
import { usePlayer, useProgress } from "../context";
import { Art, Sheet, Toggle } from "../components";
import type { VideoFit } from "../types";
import { albumKey, formatTime } from "../util";

const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SLEEP_MINUTES = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const FIT_LABEL: Record<VideoFit, string> = { contain: "Fit", cover: "Fill", fill: "Stretch" };
const NEXT_FIT: Record<VideoFit, VideoFit> = { contain: "cover", cover: "fill", fill: "contain" };

export const NowPlaying = memo(function NowPlaying({ active }: { active: boolean }) {
  const p = usePlayer();
  const { current, playing, actions, videoRef, favorites, queue, qIndex, trackMap } = p;
  const [sheet, setSheet] = useState<null | "speed" | "sleep">(null);
  const [flash, setFlash] = useState<{ text: string; side: "left" | "right" | "center"; key: number } | null>(null);
  const subtitleInput = useRef<HTMLInputElement | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const tapTimer = useRef<number | undefined>(undefined);
  const flashTimer = useRef<number | undefined>(undefined);
  const isVideo = current?.kind === "video";
  const nextTrack = trackMap.get(queue[qIndex + 1] ?? (p.repeat === "all" ? queue[0] : "") ?? "");
  const favorite = !!current && favorites.has(current.id);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (const track of Array.from(video.textTracks)) track.mode = p.subtitles ? "showing" : "disabled";
  }, [p.subtitles, videoRef]);

  const showFlash = (text: string, side: "left" | "right" | "center") => {
    setFlash({ text, side, key: Date.now() });
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 650);
  };

  const onVideoTap = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    if (tapTimer.current) {
      window.clearTimeout(tapTimer.current);
      tapTimer.current = undefined;
      if (x < 0.4) { actions.seekBy(-p.skipSeconds); showFlash(`−${p.skipSeconds}s`, "left"); }
      else if (x > 0.6) { actions.seekBy(p.skipSeconds); showFlash(`+${p.skipSeconds}s`, "right"); }
      return;
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = undefined;
      actions.togglePlay();
      showFlash(playing ? "Paused" : "Play", "center");
    }, 240);
  };

  const fullscreen = () => {
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!video) return;
    if (document.fullscreenElement) return void document.exitFullscreen();
    if (video.requestFullscreen) {
      void video.requestFullscreen().then(() => {
        if (video.videoWidth > video.videoHeight) {
          const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
          void orientation.lock?.("landscape").catch(() => {});
        }
      }).catch(() => {});
    } else video.webkitEnterFullscreen?.();
  };

  const pip = () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void video.requestPictureInPicture?.().catch(() => actions.toast("Picture-in-picture isn't available here"));
  };

  const sleepLabel = p.sleep.endOfTrack ? "End" : p.sleepRemaining != null ? formatTime(p.sleepRemaining) : "Sleep";
  const abLabel = p.ab.a == null ? "A-B" : p.ab.b == null ? "A→?" : "A↔B";
  const VolumeIcon = p.muted || p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2;

  return (
    <section className={"screen nowPlaying" + (isVideo ? " isVideo" : "")} hidden={!active}>
      <div className="npBackdrop" style={current?.cover ? ({ "--cover": `url("${current.cover}")` } as CSSProperties) : undefined} />
      <header className="npTop">
        <button className="iconBtn" aria-label="Back to library" onClick={() => actions.back()}><ChevronDown size={26} /></button>
        <div className="npSource"><small>PLAYING FROM</small><b>{current ? p.queueSource || "Library" : "—"}</b></div>
        <button className="iconBtn" aria-label="Track options" disabled={!current}
          onClick={() => current && actions.openMenu({ title: current.title, subtitle: [current.artist, current.album].filter(Boolean).join(" · "), ids: [current.id], track: current })}>
          <EllipsisVertical size={22} />
        </button>
      </header>

      <div className="npStage">
        <div className="videoStage" hidden={!isVideo} onClick={onVideoTap}>
          <video ref={videoRef} playsInline preload="auto" className={`fit-${p.videoFit}`} style={{ "--cue": `${p.subtitleSize}%` } as CSSProperties}>
            {p.subtitles && <track kind="subtitles" src={p.subtitles.url} label={p.subtitles.name} default />}
          </video>
          {flash && <span key={flash.key} className={`tapFlash ${flash.side}`}>{flash.text}</span>}
        </div>
        {!isVideo && (
          <div className={"npArtWrap" + (playing ? " playing" : "")}
            onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }}
            onPointerUp={(e) => {
              const start = swipe.current;
              swipe.current = null;
              if (!start) return;
              const dx = e.clientX - start.x;
              const dy = e.clientY - start.y;
              if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                if (dx < 0) actions.next();
                else actions.prev();
              }
            }}
            onPointerCancel={() => { swipe.current = null; }}>
            {current?.cover
              ? <Art src={current.cover} seed={current.album || current.title} className="npArt" />
              : <div className="npDisc"><Disc3 /></div>}
          </div>
        )}
      </div>

      <div className="npInfo">
        <div className="npTitles">
          <h1 title={current?.title}>{current?.title ?? "Nothing playing"}</h1>
          <p>
            {current ? (
              <>
                {current.artist ? <button className="link" onClick={() => actions.navigate({ view: "artist", name: current.artist })}>{current.artist}</button> : <span>{isVideo ? "Video" : "Unknown artist"}</span>}
                {current.album && current.kind === "audio" && <> · <button className="link" onClick={() => actions.navigate({ view: "album", key: albumKey(current) })}>{current.album}</button></>}
              </>
            ) : p.tracks.length ? "Pick something from your library" : "Add music from the Library tab"}
          </p>
        </div>
        <button className={"iconBtn heart" + (favorite ? " on" : "")} disabled={!current} aria-label={favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => current && actions.toggleFavorite([current.id])}>
          <Heart size={24} fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>

      <SeekBar />

      <div className="npControls">
        <button className={"iconBtn" + (p.shuffle ? " on" : "")} aria-label="Shuffle" aria-pressed={p.shuffle} onClick={actions.toggleShuffle}><Shuffle size={22} /></button>
        <button className="iconBtn big" aria-label="Previous" onClick={actions.prev}><SkipBack size={30} fill="currentColor" /></button>
        <button className="playBtn" aria-label={playing ? "Pause" : "Play"} onClick={actions.togglePlay}>
          {playing ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" />}
        </button>
        <button className="iconBtn big" aria-label="Next" onClick={actions.next}><SkipForward size={30} fill="currentColor" /></button>
        <button className={"iconBtn" + (p.repeat !== "off" ? " on" : "")} aria-label={`Repeat: ${p.repeat}`} onClick={actions.cycleRepeat}>
          {p.repeat === "one" ? <Repeat1 size={22} /> : <Repeat size={22} />}
        </button>
      </div>

      <div className="npTools">
        <ToolButton icon={RotateCcw} label={`−${p.skipSeconds}s`} onClick={() => actions.seekBy(-p.skipSeconds)} />
        <ToolButton icon={Gauge} label={`${p.speed}×`} on={p.speed !== 1} onClick={() => setSheet("speed")} />
        <ToolButton icon={Timer} label={sleepLabel} on={p.sleep.endOfTrack || p.sleepRemaining != null} onClick={() => setSheet("sleep")} />
        <ToolButton icon={Repeat} label={abLabel} on={p.ab.a != null} onClick={actions.cycleAB} />
        <ToolButton icon={SlidersHorizontal} label="EQ" on={p.eq.enabled} onClick={() => actions.goTo("eq")} />
        {isVideo && <ToolButton icon={Captions} label="Subs" on={!!p.subtitles} onClick={() => subtitleInput.current?.click()} />}
        {isVideo && <ToolButton icon={Scaling} label={FIT_LABEL[p.videoFit]} onClick={() => actions.setVideoFit(NEXT_FIT[p.videoFit])} />}
        {isVideo && "pictureInPictureEnabled" in document && <ToolButton icon={PictureInPicture2} label="PiP" onClick={pip} />}
        {isVideo && <ToolButton icon={Maximize} label="Full" onClick={fullscreen} />}
        <ToolButton icon={RotateCw} label={`+${p.skipSeconds}s`} onClick={() => actions.seekBy(p.skipSeconds)} />
      </div>

      <div className="npVolume">
        <button className="iconBtn" aria-label={p.muted ? "Unmute" : "Mute"} onClick={actions.toggleMute}><VolumeIcon size={20} /></button>
        <input type="range" className="range" min={0} max={1} step={0.01} value={p.muted ? 0 : p.volume} aria-label="Volume"
          style={{ "--pct": `${(p.muted ? 0 : p.volume) * 100}%` } as CSSProperties} onChange={(e) => actions.setVolume(Number(e.target.value))} />
        <span className="volValue">{Math.round((p.muted ? 0 : p.volume) * 100 * p.boost)}%</span>
      </div>

      {nextTrack && (
        <button className="npNext" onClick={() => actions.goTo("queue")}>
          <Art src={nextTrack.cover} seed={nextTrack.album || nextTrack.title} icon={nextTrack.kind === "video" ? Film : Music2} className="npNextArt" />
          <span><small>UP NEXT</small><b>{nextTrack.title}</b></span>
          <em>{nextTrack.artist}</em>
        </button>
      )}

      <input ref={subtitleInput} type="file" hidden accept=".srt,.vtt,text/vtt" onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) actions.loadSubtitles(file);
        e.currentTarget.value = "";
      }} />

      {sheet === "speed" && (
        <Sheet title="Playback speed" subtitle={`${p.speed}×`} onClose={() => setSheet(null)}>
          <div className="chips">
            {SPEEDS.map((s) => <button key={s} className={"chip" + (p.speed === s ? " on" : "")} onClick={() => actions.setSpeed(s)}>{s}×</button>)}
          </div>
          <div className="sheetRow">
            <span>Fine tune</span>
            <input type="range" className="range" min={0.25} max={4} step={0.05} value={p.speed} style={{ "--pct": `${((p.speed - 0.25) / 3.75) * 100}%` } as CSSProperties}
              onChange={(e) => actions.setSpeed(Number(e.target.value))} aria-label="Playback speed" />
          </div>
          <div className="sheetRow">
            <span>Keep pitch (no chipmunk voices)</span>
            <Toggle checked={p.preservePitch} onChange={actions.setPreservePitch} label="Keep pitch" />
          </div>
        </Sheet>
      )}

      {sheet === "sleep" && (
        <Sheet title="Sleep timer" subtitle={p.sleep.endOfTrack ? "Stops after this track" : p.sleepRemaining != null ? `${formatTime(p.sleepRemaining)} left` : "Off"} onClose={() => setSheet(null)}>
          <div className="chips">
            <button className={"chip" + (!p.sleep.endOfTrack && p.sleepRemaining == null ? " on" : "")} onClick={() => { actions.setSleep(null); setSheet(null); }}>Off</button>
            {SLEEP_MINUTES.map((m) => <button key={m} className="chip" onClick={() => { actions.setSleep(m); setSheet(null); }}>{m} min</button>)}
            <button className={"chip" + (p.sleep.endOfTrack ? " on" : "")} onClick={() => { actions.setSleep("track"); setSheet(null); }}>End of track</button>
          </div>
          <p className="hint">Volume fades out during the last 15 seconds.</p>
        </Sheet>
      )}
    </section>
  );
});

function ToolButton({ icon: Icon, label, on, onClick }: { icon: LucideIcon; label: ReactNode; on?: boolean; onClick: () => void }) {
  return <button className={"toolBtn" + (on ? " on" : "")} onClick={onClick}><Icon size={19} /><span>{label}</span></button>;
}

function SeekBar() {
  const { currentTime, duration } = useProgress();
  const { current, actions, showRemaining, ab } = usePlayer();
  const pct = duration ? Math.min(100, (currentTime / duration) * 100) : 0;
  return (
    <div className="seek">
      <div className="seekTrack">
        {ab.a != null && duration > 0 && <i className="abMark" style={{ left: `${(ab.a / duration) * 100}%` }} />}
        {ab.b != null && duration > 0 && <i className="abMark" style={{ left: `${(ab.b / duration) * 100}%` }} />}
        {ab.a != null && ab.b != null && duration > 0 && <i className="abRange" style={{ left: `${(ab.a / duration) * 100}%`, width: `${((ab.b - ab.a) / duration) * 100}%` }} />}
        <input type="range" className="range seekRange" min={0} max={duration || 0} step={0.1} value={Math.min(currentTime, duration || 0)} disabled={!current || !duration}
          aria-label="Seek" style={{ "--pct": `${pct}%` } as CSSProperties} onChange={(e) => actions.seek(Number(e.target.value))} />
      </div>
      <div className="seekTimes">
        <span>{formatTime(currentTime)}</span>
        <button onClick={() => actions.setShowRemaining(!showRemaining)} aria-label="Toggle remaining time">
          {showRemaining ? `−${formatTime(Math.max(0, duration - currentTime))}` : formatTime(duration)}
        </button>
      </div>
    </div>
  );
}
