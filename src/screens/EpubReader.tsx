import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BookOpenCheck, ChevronLeft, ChevronRight, List, LoaderCircle, Maximize, Minimize, Minus, Plus, RotateCcw, Type } from "lucide-react";
import type Book from "epubjs/types/book";
import type Rendition from "epubjs/types/rendition";
import type Contents from "epubjs/types/contents";
import type { NavItem } from "epubjs/types/navigation";
import { usePlayer } from "../context";
import { Sheet, Toggle } from "../components";
import { openEpub } from "../epub";
import { loadComicLocations, patchComic } from "../library";
import { usePref } from "../prefs";
import { compareText } from "../util";

type BookSettings = {
  fontSize: number;
  font: "publisher" | "serif" | "sans";
  lineHeight: number;
  theme: "dark" | "black" | "sepia" | "light";
  flow: "paginated" | "scrolled";
};

const DEFAULT_SETTINGS: BookSettings = { fontSize: 110, font: "publisher", lineHeight: 1.6, theme: "dark", flow: "paginated" };
const THEMES: Record<BookSettings["theme"], { bg: string; fg: string; link: string; label: string }> = {
  dark: { bg: "#121216", fg: "#e4e4ea", link: "#7db4ff", label: "Dark" },
  black: { bg: "#000000", fg: "#cfcfd4", link: "#7db4ff", label: "Black" },
  sepia: { bg: "#f3e9d2", fg: "#3d2f1f", link: "#8a4b12", label: "Sepia" },
  light: { bg: "#ffffff", fg: "#1c1c21", link: "#1d5fd1", label: "Light" },
};
const FONTS: Record<BookSettings["font"], string> = {
  publisher: "",
  serif: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif",
  sans: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

type Toc = Array<{ label: string; href: string; depth: number }>;
const flatten = (items: NavItem[], depth = 0): Toc => items.flatMap((i) => [{ label: i.label.trim(), href: i.href, depth }, ...flatten(i.subitems ?? [], depth + 1)]);
const baseHref = (href: string) => href.split("#")[0];

export function EpubReader() {
  const { comics, readerId, readerStart, comicProgress, readerSettings, actions } = usePlayer();
  const comic = comics.find((c) => c.id === readerId);
  const [settings, setSettings] = usePref<BookSettings>("bookSettings", DEFAULT_SETTINGS);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const lastCfi = useRef<string | undefined>(readerStart === 0 || !comic ? undefined : comicProgress[comic.id]?.cfi);
  const atEnd = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<Toc>([]);
  const [position, setPosition] = useState<{ pct: number | null; chapter: string; href: string; page?: number; total?: number }>({ pct: null, chapter: "", href: "" });
  const [locationsReady, setLocationsReady] = useState(false);
  const [ui, setUi] = useState(true);
  const [sheet, setSheet] = useState<null | "toc" | "settings">(null);
  const [showEnd, setShowEnd] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const theme = THEMES[settings.theme];

  const nextBook = useMemo(() => {
    if (!comic) return undefined;
    const siblings = comics.filter((c) => c.folder === comic.folder && c.shelf === comic.shelf).sort((a, b) => compareText(a.title, b.title));
    return siblings[siblings.findIndex((c) => c.id === comic.id) + 1];
  }, [comics, comic]);

  const handlers = useRef({ next: () => {}, prev: () => {}, toggleUi: () => {}, tap: (_zone: number) => {}, key: (_e: KeyboardEvent) => {} });
  handlers.current = {
    next: () => {
      if (atEnd.current) setShowEnd(true);
      else void renditionRef.current?.next();
    },
    prev: () => {
      if (showEnd) setShowEnd(false);
      else void renditionRef.current?.prev();
    },
    toggleUi: () => setUi((u) => !u),
    tap: (zone) => {
      const turns = settings.flow === "paginated" && readerSettings.tapZones;
      if (turns && zone < 0.25) handlers.current.prev();
      else if (turns && zone > 0.75) handlers.current.next();
      else setUi((u) => !u);
    },
    key: (e) => {
      if (sheet || (e.target as HTMLElement | null)?.closest?.("input:not([type=range]), select, textarea")) return;
      const keys: Record<string, () => void> = {
        ArrowRight: handlers.current.next,
        ArrowLeft: handlers.current.prev,
        PageDown: handlers.current.next,
        PageUp: handlers.current.prev,
        " ": e.shiftKey ? handlers.current.prev : handlers.current.next,
        Escape: () => actions.closeComic(),
        f: toggleFullscreen,
        "+": () => setSettings((s) => ({ ...s, fontSize: Math.min(220, s.fontSize + 10) })),
        "=": () => setSettings((s) => ({ ...s, fontSize: Math.min(220, s.fontSize + 10) })),
        "-": () => setSettings((s) => ({ ...s, fontSize: Math.max(70, s.fontSize - 10) })),
      };
      const run = keys[e.key];
      if (!run) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      run();
    },
  };

  useEffect(() => {
    if (!comic) actions.closeComic();
  }, [comic, actions]);

  useEffect(() => {
    if (!comic || !hostRef.current) return;
    const host = hostRef.current;
    let cancelled = false;
    let book: Book | null = null;
    setReady(false);
    void (async () => {
      book = await openEpub(comic.file);
      if (cancelled) return book.destroy();
      bookRef.current = book;
      const flatToc = await book.loaded.navigation
        .then((nav) => flatten(nav.toc))
        .catch(() => [] as Toc);
      setToc(flatToc);
      const rendition = book.renderTo(host, {
        width: "100%",
        height: "100%",
        flow: settings.flow === "scrolled" ? "scrolled-doc" : "paginated",
        spread: "auto",
        minSpreadWidth: 900,
        allowScriptedContent: false,
      } as Parameters<Book["renderTo"]>[1]);
      renditionRef.current = rendition;
      for (const [name, t] of Object.entries(THEMES)) {
        rendition.themes.register(name, {
          body: { background: `${t.bg} !important`, color: `${t.fg} !important` },
          "p, li, span, div, h1, h2, h3, h4, h5, h6, blockquote, td, th, em, strong, i, b": { color: "inherit !important", "background-color": "transparent !important" },
          a: { color: `${t.link} !important` },
        });
      }
      rendition.hooks.content.register((contents: Contents) => {
        const doc = contents.document;
        let start: { x: number; y: number } | null = null;
        doc.addEventListener("touchstart", (e) => {
          start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
        }, { passive: true });
        doc.addEventListener("touchend", (e) => {
          const s = start;
          start = null;
          if (!s) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            if (dx < 0) handlers.current.next();
            else handlers.current.prev();
          }
        }, { passive: true });
        doc.addEventListener("keydown", (e) => handlers.current.key(e));
      });
      rendition.on("click", (e: MouseEvent) => {
        const target = e.target as Element | null;
        if (target?.closest?.("a")) return;
        const win = e.view as Window | null;
        if (win?.getSelection()?.toString()) return;
        const frame = win?.frameElement as HTMLElement | null | undefined;
        const hostRect = host.getBoundingClientRect();
        const x = (frame ? frame.getBoundingClientRect().left : hostRect.left) + e.clientX;
        handlers.current.tap((x - hostRect.left) / hostRect.width);
      });
      rendition.on("relocated", (location: { start: { cfi: string; href: string; index: number; displayed: { page: number; total: number } }; atEnd: boolean }) => {
        const cfi = location.start.cfi;
        lastCfi.current = cfi;
        atEnd.current = location.atEnd;
        const pct = book && book.locations.length() ? book.locations.percentageFromCfi(cfi) : null;
        const href = baseHref(location.start.href);
        const chapter = [...flatToc].reverse().find((t) => baseHref(t.href).endsWith(href) || href.endsWith(baseHref(t.href)))?.label ?? "";
        setPosition({ pct, chapter, href, page: location.start.displayed?.page, total: location.start.displayed?.total });
        const fraction = location.atEnd ? 1 : pct ?? (location.start.index + 1) / (book?.spine as unknown as { length: number }).length;
        actions.setComicProgress(comic.id, { page: location.atEnd ? 999 : Math.min(998, Math.round(fraction * 999)), pages: 1000, at: Date.now(), cfi });
      });
      applyLook(rendition, settings);
      await rendition.display(lastCfi.current || undefined).catch(() => rendition.display());
      if (cancelled) return;
      setReady(true);
      try {
        const cached = await loadComicLocations(comic.id);
        if (cancelled) return;
        if (cached) book.locations.load(cached);
        else {
          await book.locations.generate(1200);
          if (cancelled) return;
          void patchComic(comic.id, { locations: book.locations.save() }).catch(() => {});
        }
        if (lastCfi.current) setPosition((p) => ({ ...p, pct: book!.locations.percentageFromCfi(lastCfi.current!) }));
      } catch {
        // Page rendering should remain usable even when location generation/cache fails.
      } finally {
        if (!cancelled) setLocationsReady(true);
      }
    })().catch((e: Error) => { if (!cancelled) setError(e?.message || "Couldn't open this book."); });
    return () => {
      cancelled = true;
      renditionRef.current?.destroy();
      renditionRef.current = null;
      book?.destroy();
      bookRef.current = null;
    };
  }, [comic?.id, settings.flow]);

  useEffect(() => {
    if (renditionRef.current && ready) applyLook(renditionRef.current, settings);
  }, [settings.fontSize, settings.font, settings.lineHeight, settings.theme, ready]);

  useEffect(() => {
    const id = window.setTimeout(() => setUi(false), 2500);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handlers.current.key(e);
    window.addEventListener("keydown", onKey, true);
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, []);

  useEffect(() => {
    if (!readerSettings.keepAwake || !navigator.wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let active = true;
    const request = () => navigator.wakeLock?.request("screen").then((lock) => { if (active) sentinel = lock; else void lock.release(); }).catch(() => {});
    void request();
    const onVisible = () => { if (document.visibilityState === "visible") void request(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      void sentinel?.release().catch(() => {});
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [readerSettings.keepAwake]);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void rootRef.current?.requestFullscreen?.().catch(() => {});
  }

  if (!comic) return null;
  const pctLabel = position.pct != null ? `${Math.round(position.pct * 100)}%` : null;
  const pageLabel = settings.flow === "paginated" && position.total ? `Page ${position.page} of ${position.total} in chapter` : "";
  const set = (patch: Partial<BookSettings>) => setSettings((s) => ({ ...s, ...patch }));

  return (
    <div ref={rootRef} className={`reader epubReader theme-${settings.theme}`} role="dialog" aria-label={comic.title} style={{ background: theme.bg } as CSSProperties}
      onClick={(e) => {
        // Taps on the page margins (outside the book's iframe) behave like taps on the text.
        if (!ready || (e.target as HTMLElement).closest(".rdTop, .rdBottom, .sheetBackdrop, .rdEnd, .rdMessage")) return;
        const rect = e.currentTarget.getBoundingClientRect();
        handlers.current.tap((e.clientX - rect.left) / rect.width);
      }}>
      <div ref={hostRef} className={"epHost" + (settings.flow === "scrolled" ? " scrolled" : "")} />
      {!ready && !error && <div className="rdMessage" style={{ color: theme.fg }}><LoaderCircle className="spin" size={34} /><p>Opening {comic.title}…</p></div>}
      {error && (
        <div className="rdMessage" style={{ color: theme.fg }}>
          <p>{error}</p>
          <button className="btn" onClick={() => actions.closeComic()}>Back to books</button>
        </div>
      )}
      {ready && !ui && (
        <div className="epFooter" aria-hidden="true" style={{ color: theme.fg }}>
          <span>{position.chapter}</span>
          <span>{pctLabel ?? ""}</span>
        </div>
      )}

      {showEnd && (
        <div className="rdEnd" onClick={() => setShowEnd(false)}>
          <div className="rdEndCard" onClick={(e) => e.stopPropagation()}>
            <BookOpenCheck size={34} />
            <h2>Finished</h2>
            <p>{comic.title}</p>
            {nextBook && <button className="btn primary wide" onClick={() => actions.openComic(nextBook.id, { fromStart: true })}>Next: {nextBook.title} <ChevronRight size={18} /></button>}
            <button className="btn wide" onClick={() => { setShowEnd(false); void renditionRef.current?.display(); }}><RotateCcw size={16} /> Start again</button>
            <button className="btn wide" onClick={() => actions.closeComic()}>Back to books</button>
          </div>
        </div>
      )}

      <div className={"rdChrome" + (ui && !showEnd ? "" : " hidden")}>
        <div className="rdTop" role="toolbar" aria-label="Reader controls">
          <button className="iconBtn" aria-label="Close book" onClick={() => actions.closeComic()}><ChevronLeft size={26} /></button>
          <div className="rdTitle">
            <b>{comic.title}</b>
            <small>{[comic.author, position.chapter].filter(Boolean).join(" · ") || " "}</small>
          </div>
          <button className="iconBtn" aria-label="Table of contents" title="Contents" disabled={!toc.length} onClick={() => setSheet("toc")}><List size={21} /></button>
          <button className="iconBtn" aria-label="Text settings" title="Text settings" onClick={() => setSheet("settings")}><Type size={21} /></button>
          <button className="iconBtn" aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen}>{fullscreen ? <Minimize size={21} /> : <Maximize size={21} />}</button>
        </div>
        <div className="rdBottom epBottom" role="toolbar" aria-label="Page navigation">
          <button className="iconBtn" aria-label="Previous page" onClick={() => handlers.current.prev()}><ChevronLeft size={24} /></button>
          <div className="epProgress">
            <input type="range" className="range" min={0} max={1000} step={1} disabled={!locationsReady} aria-label="Position in book"
              value={Math.round((position.pct ?? 0) * 1000)} style={{ "--pct": `${(position.pct ?? 0) * 100}%` } as CSSProperties}
              onChange={(e) => {
                const book = bookRef.current;
                if (!book || !locationsReady) return;
                const cfi = book.locations.cfiFromPercentage(Number(e.target.value) / 1000);
                if (cfi) void renditionRef.current?.display(cfi);
              }} />
            <small>{locationsReady ? [pctLabel, pageLabel].filter(Boolean).join(" · ") : "Counting pages…"}</small>
          </div>
          <button className="iconBtn" aria-label="Next page" onClick={() => handlers.current.next()}><ChevronRight size={24} /></button>
        </div>
      </div>

      {sheet === "toc" && (
        <Sheet title="Contents" subtitle={comic.title} onClose={() => setSheet(null)}>
          <div className="tocList">
            {toc.map((item, i) => {
              const current = baseHref(item.href) === position.href || position.href.endsWith(baseHref(item.href));
              return (
                <button key={i} className={"tocItem" + (current ? " on" : "")} style={{ paddingLeft: 12 + item.depth * 18 }}
                  onClick={() => { setSheet(null); void renditionRef.current?.display(item.href); }}>
                  {item.label}
                </button>
              );
            })}
          </div>
        </Sheet>
      )}

      {sheet === "settings" && (
        <Sheet title="Text settings" subtitle={comic.title} onClose={() => setSheet(null)}>
          <div className="readerSetting">
            <span>Text size · {settings.fontSize}%</span>
            <div className="sizeStepper">
              <button className="iconBtn" aria-label="Smaller text" onClick={() => set({ fontSize: Math.max(70, settings.fontSize - 10) })}><Minus size={18} /></button>
              <input type="range" className="range" min={70} max={220} step={5} value={settings.fontSize} aria-label="Text size"
                style={{ "--pct": `${((settings.fontSize - 70) / 150) * 100}%` } as CSSProperties} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
              <button className="iconBtn" aria-label="Larger text" onClick={() => set({ fontSize: Math.min(220, settings.fontSize + 10) })}><Plus size={18} /></button>
            </div>
          </div>
          <Choice label="Font" value={settings.font} onPick={(font) => set({ font })} options={[["publisher", "Original"], ["serif", "Serif"], ["sans", "Sans"]]} />
          <Choice label="Line spacing" value={String(settings.lineHeight)} onPick={(v) => set({ lineHeight: Number(v) })} options={[["1.3", "Compact"], ["1.6", "Normal"], ["1.9", "Relaxed"]]} />
          <Choice label="Theme" value={settings.theme} onPick={(t) => set({ theme: t })} options={Object.entries(THEMES).map(([k, t]) => [k as BookSettings["theme"], t.label])} />
          <Choice label="Layout" value={settings.flow} onPick={(flow) => set({ flow })} options={[["paginated", "Pages"], ["scrolled", "Scroll"]]} />
          <div className="sheetRow"><span>Tap screen edges to turn pages</span><Toggle checked={readerSettings.tapZones} onChange={(tapZones) => actions.setReaderSettings((s) => ({ ...s, tapZones }))} label="Tap to turn" /></div>
          <div className="sheetRow"><span>Keep screen on while reading</span><Toggle checked={readerSettings.keepAwake} onChange={(keepAwake) => actions.setReaderSettings((s) => ({ ...s, keepAwake }))} label="Keep screen on" /></div>
        </Sheet>
      )}
    </div>
  );
}

function applyLook(rendition: Rendition, s: BookSettings) {
  rendition.themes.select(s.theme);
  rendition.themes.fontSize(`${s.fontSize}%`);
  rendition.themes.override("line-height", String(s.lineHeight), true);
  if (FONTS[s.font]) rendition.themes.override("font-family", FONTS[s.font], true);
  else rendition.themes.override("font-family", "inherit");
}

function Choice<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: Array<[T, string]>; onPick: (v: T) => void }) {
  return (
    <div className="readerSetting">
      <span>{label}</span>
      <div className="chips compact">
        {options.map(([v, text]) => <button key={v} className={"chip" + (v === value ? " on" : "")} onClick={() => onPick(v)}>{text}</button>)}
      </div>
    </div>
  );
}
