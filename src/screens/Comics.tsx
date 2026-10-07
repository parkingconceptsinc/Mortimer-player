import { useMemo, useState } from "react";
import { BookOpen, BookOpenCheck, CheckCheck, EllipsisVertical, FilePlus, FolderOpen, Info, RotateCcw, Search, Trash2, Undo2, X } from "lucide-react";
import { usePlayer } from "../context";
import { Art, ScreenHeader, Sheet, SheetItem } from "../components";
import { usePref } from "../prefs";
import type { Comic, ComicSort } from "../types";
import { compareText, formatSize } from "../util";

const seriesName = (path: string) => (path ? path.slice(path.lastIndexOf("/") + 1) : "Other");

export function Comics() {
  const { comics, comicProgress, actions } = usePlayer();
  const [sort, setSort] = usePref<ComicSort>("comicSort", "recent");
  const [series, setSeries] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ comic: Comic; info: boolean } | null>(null);
  const folders = useMemo(() => Array.from(new Set(comics.map((c) => c.folder))).sort(compareText), [comics]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = comics.filter((c) => (series == null || c.folder === series) && (!q || c.title.toLowerCase().includes(q) || c.folder.toLowerCase().includes(q)));
    if (sort === "title") list.sort((a, b) => compareText(a.title, b.title));
    else if (sort === "added") list.sort((a, b) => b.addedAt - a.addedAt);
    else list.sort((a, b) => (comicProgress[b.id]?.at ?? 0) - (comicProgress[a.id]?.at ?? 0) || b.addedAt - a.addedAt);
    return list;
  }, [comics, series, query, sort, comicProgress]);

  const reading = useMemo(() => comics
    .filter((c) => { const p = comicProgress[c.id]; return p && p.page > 0 && p.page < p.pages - 1; })
    .sort((a, b) => comicProgress[b.id].at - comicProgress[a.id].at)
    .slice(0, 12), [comics, comicProgress]);

  const status = (c: Comic) => {
    const p = comicProgress[c.id];
    if (!p) return { pct: 0, label: c.pages ? `${c.pages} pages` : c.format.toUpperCase() };
    if (p.page >= p.pages - 1) return { pct: 100, label: "Read" };
    return { pct: ((p.page + 1) / p.pages) * 100, label: `Page ${p.page + 1} of ${p.pages}` };
  };

  return (
    <section className="screen comicsScreen">
      <ScreenHeader title="Comics" subtitle={comics.length ? `${comics.length} comic${comics.length === 1 ? "" : "s"}${folders.length > 1 ? ` · ${folders.length} series` : ""}` : undefined}>
        <button className="iconBtn" aria-label="Add folder" title="Add folder" onClick={actions.importFolder}><FolderOpen size={20} /></button>
        <button className="iconBtn" aria-label="Add files" title="Add files" onClick={actions.importFiles}><FilePlus size={20} /></button>
      </ScreenHeader>

      {!comics.length ? (
        <div className="emptyState welcome">
          <div className="heroDisc"><BookOpen /></div>
          <h2>Your comic shelf</h2>
          <p>Add CBZ, CBR or PDF comics and manga. Swipe to turn pages, pinch or double-tap to zoom, read right-to-left or as a vertical webtoon — and pick up where you left off.</p>
          <div className="heroActions">
            <button className="btn primary" onClick={actions.importFolder}><FolderOpen size={18} /> Add comics folder</button>
            <button className="btn" onClick={actions.importFiles}><FilePlus size={18} /> Add files</button>
          </div>
          <small>Comics found while adding a music folder show up here too.</small>
        </div>
      ) : (
        <>
          <label className="searchBox">
            <Search size={17} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search comics" />
            {query && <button className="iconBtn" aria-label="Clear search" onClick={() => setQuery("")}><X size={16} /></button>}
          </label>

          {!query && series == null && reading.length > 0 && (
            <>
              <div className="sectionTitle"><h2>Continue reading</h2></div>
              <div className="comicRow">
                {reading.map((c) => <ComicCard key={c.id} comic={c} status={status(c)} onOpen={() => actions.openComic(c.id)} onMenu={() => setMenu({ comic: c, info: false })} />)}
              </div>
            </>
          )}

          {folders.length > 1 && (
            <div className="chips scrollChips">
              <button className={"chip" + (series == null ? " on" : "")} onClick={() => setSeries(null)}>All</button>
              {folders.map((f) => <button key={f} className={"chip" + (series === f ? " on" : "")} onClick={() => setSeries(f)}>{seriesName(f)}</button>)}
            </div>
          )}
          <div className="listToolbar">
            <span className="listMeta">{shown.length} comic{shown.length === 1 ? "" : "s"}</span>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as ComicSort)} aria-label="Sort comics">
              <option value="recent">Recently read</option>
              <option value="added">Recently added</option>
              <option value="title">Title</option>
            </select>
          </div>
          {!shown.length ? <div className="emptyState"><p>No comics match.</p></div> : (
            <div className="comicGrid">
              {shown.map((c) => <ComicCard key={c.id} comic={c} status={status(c)} onOpen={() => actions.openComic(c.id)} onMenu={() => setMenu({ comic: c, info: false })} />)}
            </div>
          )}
        </>
      )}

      {menu && (
        <Sheet title={menu.comic.title} subtitle={seriesName(menu.comic.folder)} onClose={() => setMenu(null)}
          cover={<Art src={menu.comic.cover} seed={menu.comic.title} icon={BookOpen} className="sheetCover comicSheetCover" />}>
          {menu.info ? (
            <dl className="infoList">
              {([
                ["File", menu.comic.name], ["Format", menu.comic.format.toUpperCase()], ["Pages", menu.comic.pages ?? "—"],
                ["Size", formatSize(menu.comic.size)], ["Folder", menu.comic.folder || "—"], ["Added", new Date(menu.comic.addedAt).toLocaleString()],
                ["Progress", status(menu.comic).label],
              ] as Array<[string, string | number]>).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          ) : (
            <>
              <SheetItem icon={BookOpen} label={comicProgress[menu.comic.id] ? "Continue reading" : "Read"} onClick={() => { actions.openComic(menu.comic.id); setMenu(null); }} />
              <SheetItem icon={RotateCcw} label="Read from the beginning" onClick={() => { actions.openComic(menu.comic.id, { fromStart: true }); setMenu(null); }} />
              {status(menu.comic).pct < 100
                ? <SheetItem icon={CheckCheck} label="Mark as read" onClick={() => {
                    const pages = menu.comic.pages ?? comicProgress[menu.comic.id]?.pages ?? 1;
                    actions.setComicProgress(menu.comic.id, { page: pages - 1, pages, at: Date.now() });
                    setMenu(null);
                  }} />
                : <SheetItem icon={Undo2} label="Mark as unread" onClick={() => { actions.setComicProgress(menu.comic.id, null); setMenu(null); }} />}
              <SheetItem icon={Info} label="Details" onClick={() => setMenu({ ...menu, info: true })} />
              <SheetItem icon={Trash2} danger label="Remove from library" onClick={() => {
                if (!window.confirm(`Remove “${menu.comic.title}” from the app? The original file is not touched.`)) return;
                actions.removeComics([menu.comic.id]);
                setMenu(null);
              }} />
            </>
          )}
        </Sheet>
      )}
    </section>
  );
}

function ComicCard({ comic, status, onOpen, onMenu }: { comic: Comic; status: { pct: number; label: string }; onOpen: () => void; onMenu: () => void }) {
  return (
    <div className="comicCard" onContextMenu={(e) => { e.preventDefault(); onMenu(); }}>
      <div className="comicCover" onClick={onOpen}>
        <Art src={comic.cover} seed={comic.title} icon={BookOpen} />
        {status.pct >= 100 && <span className="comicBadge"><BookOpenCheck size={14} /></span>}
        {status.pct > 0 && status.pct < 100 && <i className="comicProgress" style={{ width: `${status.pct}%` }} />}
        <span className="comicFormat">{comic.format.toUpperCase()}</span>
      </div>
      <div className="comicMeta">
        <button className="cardTitle" onClick={onOpen}>
          <b>{comic.title}</b>
          <small>{status.label}</small>
        </button>
        <button className="iconBtn" aria-label={`More options for ${comic.title}`} onClick={onMenu}><EllipsisVertical size={18} /></button>
      </div>
    </div>
  );
}
