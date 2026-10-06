import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ListPlus, ListX, Shuffle, X } from "lucide-react";
import { usePlayer } from "../context";
import { ScreenHeader, TrackRow } from "../components";
import type { Track } from "../types";
import { formatTotal } from "../util";

export function Queue() {
  const { queue, qIndex, trackMap, playing, favorites, shuffle, queueSource, actions } = usePlayer();
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState(200);
  const activeRow = useRef<HTMLDivElement | null>(null);
  const entries = queue.map((id, index) => ({ index, track: trackMap.get(id) })).filter((e): e is { index: number; track: Track } => !!e.track);
  const remaining = entries.slice(qIndex + 1).reduce((sum, e) => sum + (e.track.duration ?? 0), 0);

  useEffect(() => {
    if (qIndex + 50 > limit) setLimit(qIndex + 200);
    requestAnimationFrame(() => activeRow.current?.scrollIntoView({ block: "center" }));
  }, []);

  const onPlay = useCallback((_t: Track, index: number) => actions.jump(index), [actions]);
  const onMenu = useCallback((t: Track, index: number) => actions.openMenu({ title: t.title, subtitle: t.artist, ids: [t.id], track: t, queueIndex: index }), [actions]);

  return (
    <section className="screen queueScreen">
      <ScreenHeader title="Queue" subtitle={queue.length ? `${queue.length} tracks${remaining ? ` · ${formatTotal(remaining)} left` : ""} · from ${queueSource || "Library"}` : undefined}>
        {queue.length > 0 && (
          <>
            <button className={"iconBtn" + (shuffle ? " on" : "")} aria-label="Shuffle queue" title="Shuffle" onClick={actions.toggleShuffle}><Shuffle size={20} /></button>
            <button className="iconBtn" aria-label="Save queue as playlist" title="Save as playlist" onClick={() => {
              const name = window.prompt("Save queue as playlist", `Queue ${new Date().toLocaleDateString()}`)?.trim();
              if (name) actions.createPlaylist(name, queue);
            }}><ListPlus size={20} /></button>
            <button className="iconBtn" aria-label="Clear queue" title="Clear queue" onClick={() => { if (window.confirm("Clear the queue?")) actions.clearQueue(); }}><ListX size={20} /></button>
          </>
        )}
      </ScreenHeader>
      {!entries.length ? (
        <div className="emptyState"><p>The queue is empty. Play an album, artist or playlist — or use “Play next” / “Add to queue” on any song.</p></div>
      ) : (
        <>
          <div className="listToolbar">
            <span className="listMeta">Tap a track to jump to it</span>
            <button className={"btn small" + (editing ? " primary" : "")} onClick={() => setEditing((e) => !e)}>{editing ? "Done" : "Edit"}</button>
          </div>
          <div className="trackList">
            {entries.slice(0, limit).map(({ index, track }) => (
              <div key={index} ref={index === qIndex ? activeRow : undefined} className={index < qIndex ? "played" : ""}>
                <TrackRow track={track} index={index} active={index === qIndex} playing={playing} favorite={favorites.has(track.id)} onPlay={onPlay} onMenu={onMenu}
                  trailing={editing ? (
                    <span className="reorder" onClick={(e) => e.stopPropagation()}>
                      <button className="iconBtn" aria-label="Move up" disabled={index === 0} onClick={() => actions.moveInQueue(index, index - 1)}><ArrowUp size={16} /></button>
                      <button className="iconBtn" aria-label="Move down" disabled={index === queue.length - 1} onClick={() => actions.moveInQueue(index, index + 1)}><ArrowDown size={16} /></button>
                      <button className="iconBtn" aria-label="Remove from queue" onClick={() => actions.removeFromQueue(index)}><X size={16} /></button>
                    </span>
                  ) : undefined} />
              </div>
            ))}
            {limit < entries.length && <button className="btn small more" onClick={() => setLimit((l) => l + 300)}>Show more ({entries.length - limit})</button>}
          </div>
        </>
      )}
    </section>
  );
}
