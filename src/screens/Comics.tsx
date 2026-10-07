import { useMemo, useState } from "react";
import { ArrowLeftRight, BookOpen, BookOpenCheck, BookText, CheckCheck, EllipsisVertical, FilePlus, FolderOpen, Info, RotateCcw, Search, Trash2, Undo2, X } from "lucide-react";
import { usePlayer } from "../context";
import { Art, ScreenHeader, Sheet, SheetItem } from "../components";
import { usePref } from "../prefs";
import type { Comic, ComicSort, Shelf } from "../types";
import { compareText, formatSize } from "../util";

const seriesName = (path: string) => (path ? path.slice(path.lastIndexOf("/") + 1) : "Other");

export function Comics({ shelfOverride }: { shelfOverride?: Shelf }) {
  const { comics: everything, comicProgress, actions } = usePlayer();
  const [preferredShelf, setShelf] = usePref<Shelf>("readShelf", "books");
  const counts = { books: everything.filter((c) => c.shelf === "books").length, comics: everything.filter((c) => c.shelf === "comics").length };
  const other: Shelf = preferredShelf === "books" ? "comics" : "books";
  // Land on the shelf that has something in it rather than an empty one.
  const shelf: Shelf = shelfOverride ?? (counts[preferredShelf] || !counts[other] ? preferredShelf : other);
  const comics = useMemo(() => everything.filter((c) => c.shelf === shelf), [everything, shelf]);
  const noun = shelf === "books" ? "book" : "comic";
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
    const pct = ((p.page + 1) / p.pages) * 100;
    return { pct, label: c.format === "epub" ? `${Math.max(1, Math.round(pct))}% read` : `Page ${p.page + 1} of ${p.pages}` };
  };

  return (
    <section className="screen comicsScreen">
      <ScreenHeader title={shelf === "books" ? "Books" : "Comics"} subtitle={comics.length ? `${comics.length} ${noun}${comics.length === 1 ? "" : "s"}${folders.length > 1 ? ` · ${folders.length} ${shelf === "books" ? "folders" : "series"}` : ""}` : undefined}>
        <button className="iconBtn" aria-label="Add folder" title="Add folder" onClick={actions.importFolder}><FolderOpen size={20} /></button>
        <button className="iconBtn" aria-label="Add files" title="Add files" onClick={actions.importFiles}><FilePlus size={20} /></button>
      </ScreenHeader>

      <div className="segmented" role="tablist" aria-label="Shelf">
        <button role="tab" aria-selected={shelf === "books"} className={shelf === "books" ? "on" : ""} onClick={() => { setShelf("books"); setSeries(null); }}>
          <BookText size={16} /> Books <em>{counts.books}</em>
        </button>
        <button role="tab" aria-selected={shelf === "comics"} className={shelf === "comics" ? "on" : ""} onClick={() => { setShelf("comics"); setSeries(null); }}>
          <BookOpen size={16} /> Comics <em>{counts.comics}</em>
        </button>
      </div>

      {!comics.length && shelf === "books" ? (
        <div className="emptyState welcome">
          <div className="heroDisc"><BookText /></div>
          <h2>Your bookshelf</h2>
          <p>Add EPUB and PDF books. Choose the text size, font and theme (dark, sepia or light), jump through the table of contents and pick up exactly where you left off.</p>
          <div className="heroActions">
            <button className="btn primary" onClick={actions.importFolder}><FolderOpen size={18} /> Add books folder</button>
            <button className="btn" onClick={actions.importFiles}><FilePlus size={18} /> Add files</button>
          </div>
          <small>PDFs land here; move any of them to Comics from its menu.</small>
        </div>
      ) : !comics.length ? (
        <div className="emptyState welcome">
          <div className="heroDisc"><BookOpen /></div>
          <h2>Your comic shelf</h2>
          <p>Add CBZ or CBR comics and manga (or move a PDF here). Swipe to turn pages, pinch or double-tap to zoom, read right-to-left or as a vertical webtoon — and pick up where you left off.</p>
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
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${noun}s`} />
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
            <span className="listMeta">{shown.length} {noun}{shown.length === 1 ? "" : "s"}</span>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as ComicSort)} aria-label="Sort comics">
              <option value="recent">Recently read</option>
              <option value="added">Recently added</option>
              <option value="title">Title</option>
            </select>
          </div>
          {!shown.length ? <div className="emptyState"><p>No {noun}s match.</p></div> : (
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
                ["File", menu.comic.name], ...(menu.comic.author ? [["Author", menu.comic.author]] : []), ["Format", menu.comic.format.toUpperCase()], ["Pages", menu.comic.pages ?? "—"],
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
                    const pages = menu.comic.format === "epub" ? 1000 : menu.comic.pages ?? comicProgress[menu.comic.id]?.pages ?? 1;
                    actions.setComicProgress(menu.comic.id, { page: pages - 1, pages, at: Date.now() });
                    setMenu(null);
                  }} />
                : <SheetItem icon={Undo2} label="Mark as unread" onClick={() => { actions.setComicProgress(menu.comic.id, null); setMenu(null); }} />}
              <SheetItem icon={ArrowLeftRight} label={menu.comic.shelf === "books" ? "Move to Comics" : "Move to Books"} onClick={() => {
                actions.setComicShelf(menu.comic.id, menu.comic.shelf === "books" ? "comics" : "books");
                setMenu(null);
              }} />
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
          <small>{[comic.author, status.label].filter(Boolean).join(" · ")}</small>
        </button>
        <button className="iconBtn" aria-label={`More options for ${comic.title}`} onClick={onMenu}><EllipsisVertical size={18} /></button>
      </div>
    </div>
  );
}
