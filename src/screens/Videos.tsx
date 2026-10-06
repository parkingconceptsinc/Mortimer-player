import { useMemo, useState } from "react";
import { Clapperboard, EllipsisVertical, FilePlus, Film, FolderOpen, Play, Search, Shuffle, X } from "lucide-react";
import { usePlayer } from "../context";
import { Art, NowBars, ScreenHeader } from "../components";
import { usePref } from "../prefs";
import type { Track, VideoSort } from "../types";
import { compareText, formatSize, formatTime, formatTotal, matches } from "../util";

const folderName = (path: string) => (path ? path.slice(path.lastIndexOf("/") + 1) : "Other");

export function Videos() {
  const { tracks, current, playing, videoProgress, actions } = usePlayer();
  const [sort, setSort] = usePref<VideoSort>("videoSort", "added");
  const [folder, setFolder] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const videos = useMemo(() => tracks.filter((t) => t.kind === "video"), [tracks]);
  const folders = useMemo(() => Array.from(new Set(videos.map((v) => v.folder))).sort(compareText), [videos]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = videos.filter((v) => (folder == null || v.folder === folder) && (!q || matches(v, q)));
    if (sort === "title") list.sort((a, b) => compareText(a.title, b.title));
    else if (sort === "duration") list.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
    else if (sort === "size") list.sort((a, b) => b.size - a.size);
    else list.sort((a, b) => b.addedAt - a.addedAt);
    return list;
  }, [videos, folder, query, sort]);

  const ids = shown.map((v) => v.id);
  const total = videos.reduce((sum, v) => sum + (v.duration ?? 0), 0);
  const play = (v?: Track, shuffle = false) => actions.playTracks(ids, v?.id, { shuffle, source: folder == null ? "Videos" : folderName(folder) });

  return (
    <section className="screen videosScreen">
      <ScreenHeader title="Videos" subtitle={videos.length ? `${videos.length} video${videos.length === 1 ? "" : "s"}${total ? ` · ${formatTotal(total)}` : ""}` : undefined}>
        <button className="iconBtn" aria-label="Add folder" title="Add folder" onClick={actions.importFolder}><FolderOpen size={20} /></button>
        <button className="iconBtn" aria-label="Add files" title="Add files" onClick={actions.importFiles}><FilePlus size={20} /></button>
      </ScreenHeader>

      {!videos.length ? (
        <div className="emptyState welcome">
          <div className="heroDisc"><Clapperboard /></div>
          <h2>No videos yet</h2>
          <p>Add a folder or pick video files. They get thumbnails, remember where you stopped and play in a full-screen player with gestures and subtitles.</p>
          <div className="heroActions">
            <button className="btn primary" onClick={actions.importFolder}><FolderOpen size={18} /> Add video folder</button>
            <button className="btn" onClick={actions.importFiles}><FilePlus size={18} /> Add files</button>
          </div>
          <small>MP4, WebM, MOV and M4V play in every modern browser; MKV/AVI depend on the codecs inside.</small>
        </div>
      ) : (
        <>
          <label className="searchBox">
            <Search size={17} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search videos" />
            {query && <button className="iconBtn" aria-label="Clear search" onClick={() => setQuery("")}><X size={16} /></button>}
          </label>
          {folders.length > 1 && (
            <div className="chips scrollChips">
              <button className={"chip" + (folder == null ? " on" : "")} onClick={() => setFolder(null)}>All</button>
              {folders.map((f) => <button key={f} className={"chip" + (folder === f ? " on" : "")} onClick={() => setFolder(f)}>{folderName(f)}</button>)}
            </div>
          )}
          <div className="listToolbar">
            <button className="btn primary small" disabled={!shown.length} onClick={() => play()}><Play size={16} fill="currentColor" /> Play</button>
            <button className="btn small" disabled={shown.length < 2} onClick={() => play(undefined, true)}><Shuffle size={16} /> Shuffle</button>
            <span className="listMeta">{shown.length} shown</span>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as VideoSort)} aria-label="Sort videos">
              <option value="added">Recently added</option>
              <option value="title">Name</option>
              <option value="duration">Longest</option>
              <option value="size">Largest</option>
            </select>
          </div>
          {!shown.length ? <div className="emptyState"><p>No videos match.</p></div> : (
            <div className="videoGrid">
              {shown.map((v) => {
                const watched = videoProgress[v.id] ?? 0;
                const pct = v.duration && watched ? Math.min(100, (watched / v.duration) * 100) : 0;
                const isCurrent = current?.id === v.id;
                return (
                  <div key={v.id} className={"videoCard" + (isCurrent ? " active" : "")} onClick={() => play(v)}
                    onContextMenu={(e) => { e.preventDefault(); actions.openMenu({ title: v.title, subtitle: v.folder, ids: [v.id], track: v }); }}>
                    <div className="videoThumb">
                      <Art src={v.cover} seed={v.title} icon={Film} />
                      {v.duration ? <span className="videoDur">{formatTime(v.duration)}</span> : null}
                      {isCurrent && <span className="videoNow"><NowBars paused={!playing} /></span>}
                      {pct > 0 && <i className="videoProgress" style={{ width: `${pct}%` }} />}
                      <span className="videoPlayIcon"><Play size={22} fill="currentColor" /></span>
                    </div>
                    <div className="videoMeta">
                      <div>
                        <b>{v.title}</b>
                        <small>{[pct >= 97 ? "Watched" : pct > 0 ? `${Math.round(pct)}% watched` : null, v.name.split(".").pop()?.toUpperCase(), formatSize(v.size)].filter(Boolean).join(" · ")}</small>
                      </div>
                      <button className="iconBtn" aria-label="More options" onClick={(e) => { e.stopPropagation(); actions.openMenu({ title: v.title, subtitle: v.folder, ids: [v.id], track: v }); }}>
                        <EllipsisVertical size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
