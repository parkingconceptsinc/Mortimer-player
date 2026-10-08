import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { BookOpenCheck, ChevronLeft, ChevronRight, LayoutGrid, LoaderCircle, Maximize, Minimize, RotateCcw, Settings2 } from "lucide-react";
import { usePlayer } from "../context";
import { Sheet, Toggle } from "../components";
import { makeThumbnail, openComic, type ComicSource } from "../comics";
import type { ReaderSettings } from "../types";
import { compareText } from "../util";

type Zoom = { z: number; x: number; y: number };
const Z0: Zoom = { z: 1, x: 0, y: 0 };
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function ComicReader() {
  const { comics, readerId, readerStart, comicProgress, readerSettings: s, actions } = usePlayer();
  const comic = comics.find((c) => c.id === readerId);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [source, setSource] = useState<ComicSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openProgress, setOpenProgress] = useState(0);
  const [page, setPage] = useState(() => {
    if (readerStart != null) return readerStart;
    const saved = comic ? comicProgress[comic.id] : undefined;
    return saved && saved.page < saved.pages - 1 ? saved.page : 0;
  });
  const [urls, setUrls] = useState<Map<number, string>>(() => new Map());
  const [failed, setFailed] = useState<Set<number>>(() => new Set());
  const [sizes, setSizes] = useState<Record<number, string>>({});
  const [ui, setUi] = useState(true);
  const [sheet, setSheet] = useState<null | "settings" | "pages">(null);
  const [showEnd, setShowEnd] = useState(false);
  const [box, setBox] = useState({ W: 0, H: 0 });
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [zoom, setZoomState] = useState<Zoom>(Z0);
  const [fullscreen, setFullscreen] = useState(false);
  const urlsRef = useRef(urls);
  const loading = useRef(new Set<number>());
  const pageRef = useRef(page);
  const zoomRef = useRef<Zoom>(Z0);
  const pendingTurn = useRef<number | null>(null);
  const turnFallback = useRef<number | undefined>(undefined);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x0: number; y0: number; t0: number; mode: null | "swipe" | "pan"; px: number; py: number } | null>(null);
  const pinch = useRef<{ d0: number; z0: number; ux: number; uy: number } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const tapTimer = useRef<number | undefined>(undefined);
  const lastWheel = useRef(0);
  const thumbs = useRef(new Map<number, string>());
  const sourceRef = useRef<ComicSource | null>(null);
  const scrolledInitially = useRef(false);
  pageRef.current = page;

  const pages = source?.pages ?? comic?.pages ?? 0;
  const vertical = s.mode === "vertical";
  const spreads = useMemo(() => {
    if (!pages) return [] as number[][];
    if (s.mode !== "double") return Array.from({ length: pages }, (_, i) => [i]);
    const out: number[][] = [[0]];
    for (let i = 1; i < pages; i += 2) out.push(i + 1 < pages ? [i, i + 1] : [i]);
    return out;
  }, [pages, s.mode]);
  const spreadIndex = Math.max(0, spreads.findIndex((sp) => sp.includes(page)));
  const nextComic = useMemo(() => {
    if (!comic) return undefined;
    const siblings = comics.filter((c) => c.folder === comic.folder).sort((a, b) => compareText(a.title, b.title));
    return siblings[siblings.findIndex((c) => c.id === comic.id) + 1];
  }, [comics, comic]);

  const setZoom = useCallback((z: Zoom) => {
    zoomRef.current = z;
    setZoomState(z);
  }, []);

  useEffect(() => {
    if (!comic) actions.closeComic();
  }, [comic, actions]);

  useEffect(() => {
    if (!comic) return;
    let cancelled = false;
    let opened: ComicSource | null = null;
    openComic(comic.file, (f) => { if (!cancelled) setOpenProgress(f); })
      .then((src) => {
        if (cancelled) return src.close();
        opened = src;
        sourceRef.current = src;
        setSource(src);
        setPage((p) => (p >= src.pages ? 0 : p));
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message || "Couldn't open this comic."); });
    return () => {
      cancelled = true;
      if (sourceRef.current === opened) sourceRef.current = null;
      opened?.close();
    };
  }, [comic?.id]);

  useEffect(() => () => {
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    for (const url of thumbs.current.values()) URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    if (!source) return;
    const ahead = vertical ? 4 : s.mode === "double" ? 5 : 3;
    const wanted: number[] = [];
    for (let i = page - 2; i <= page + ahead; i++) if (i >= 0 && i < source.pages) wanted.push(i);
    wanted.sort((a, b) => Math.abs(a - page) - Math.abs(b - page));
    for (const i of wanted) {
      if (urlsRef.current.has(i) || loading.current.has(i)) continue;
      loading.current.add(i);
      source.getPage(i).then((blob) => {
        loading.current.delete(i);
        if (sourceRef.current !== source) return;
        const url = URL.createObjectURL(blob);
        const next = new Map(urlsRef.current);
        next.set(i, url);
        for (const [k, u] of next) {
          if (Math.abs(k - pageRef.current) > 12) {
            URL.revokeObjectURL(u);
            next.delete(k);
          }
        }
        urlsRef.current = next;
        setUrls(next);
      }).catch(() => {
        loading.current.delete(i);
        if (sourceRef.current === source) setFailed((f) => new Set(f).add(i));
      });
    }
  }, [source, page, s.mode, vertical]);

  useEffect(() => {
    if (comic && pages) actions.setComicProgress(comic.id, { page, pages, at: Date.now() });
  }, [page, pages, comic?.id, actions]);

  useEffect(() => {
    const id = window.setTimeout(() => setUi(false), 2200);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!s.keepAwake || !navigator.wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let active = true;
    const request = () => {
      navigator.wakeLock?.request("screen").then((lock) => {
        if (active) sentinel = lock;
        else void lock.release();
      }).catch(() => {});
    };
    request();
    const onVisible = () => { if (document.visibilityState === "visible") request(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      void sentinel?.release().catch(() => {});
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [s.keepAwake]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setBox({ W: stage.clientWidth, H: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [vertical, source]);

  useEffect(() => setZoom(Z0), [s.fit, s.mode, box.W, box.H, setZoom]);

  // ---------- navigation ----------
  const goSpread = useCallback((n: number) => {
    if (!spreads.length) return;
    const target = clamp(n, 0, spreads.length - 1);
    setPage(spreads[target][0]);
    setZoom(Z0);
    setShowEnd(false);
  }, [spreads, setZoom]);

  const scrollToPage = (n: number, smooth = true) => {
    scrollRef.current?.querySelector(`[data-i="${n}"]`)?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  };

  const finishTurn = () => {
    window.clearTimeout(turnFallback.current);
    if (pendingTurn.current != null) goSpread(pendingTurn.current);
    pendingTurn.current = null;
    setAnimating(false);
    setDx(0);
  };

  const springBack = () => {
    if (dx === 0) return setAnimating(false);
    setAnimating(true);
    setDx(0);
    window.clearTimeout(turnFallback.current);
    turnFallback.current = window.setTimeout(finishTurn, 400);
  };

  const logical = (dir: 1 | -1) => {
    if (vertical) {
      if (dir === 1 && page >= pages - 1) return setShowEnd(true);
      return scrollToPage(clamp(page + dir, 0, pages - 1));
    }
    if (dir === -1 && showEnd) return setShowEnd(false);
    if (dir === 1 && spreadIndex >= spreads.length - 1) {
      springBack();
      return setShowEnd(true);
    }
    if (dir === -1 && spreadIndex <= 0) return springBack();
    if (!box.W) return goSpread(spreadIndex + dir);
    const side = (dir === 1) === (s.direction === "ltr") ? 1 : -1;
    pendingTurn.current = spreadIndex + dir;
    setAnimating(true);
    setDx(side === 1 ? -box.W : box.W);
    window.clearTimeout(turnFallback.current);
    turnFallback.current = window.setTimeout(finishTurn, 400);
  };

  const visual = (side: 1 | -1) => logical((side === 1) === (s.direction === "ltr") ? 1 : -1);

  const jumpTo = (n: number) => {
    if (vertical) {
      setPage(n);
      scrollToPage(n, false);
    } else goSpread(spreads.findIndex((sp) => sp.includes(n)));
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void rootRef.current?.requestFullscreen?.().catch(() => {});
  };

  // ---------- zoom & pan ----------
  const measure = () => {
    const stage = stageRef.current;
    const el = contentRef.current;
    if (!stage || !el) return null;
    return { W: stage.clientWidth, H: stage.clientHeight, L: el.offsetLeft, T: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  };

  const clampPan = (z: Zoom): Zoom => {
    const m = measure();
    if (!m) return Z0;
    const w = m.w * z.z;
    const h = m.h * z.z;
    const x = w <= m.W ? (m.W - w) / 2 - m.L : clamp(z.x, m.W - w - m.L, -m.L);
    const y = h <= m.H ? (m.H - h) / 2 - m.T : clamp(z.y, m.H - h - m.T, -m.T);
    return { z: z.z, x, y };
  };

  const zoomAround = (px: number, py: number, nextZ: number) => {
    const m = measure();
    if (!m) return;
    const cur = zoomRef.current;
    const z = clamp(nextZ, 1, 5);
    const ux = (px - m.L - cur.x) / cur.z;
    const uy = (py - m.T - cur.y) / cur.z;
    setZoom(z <= 1.001 ? clampPan(Z0) : clampPan({ z, x: px - m.L - ux * z, y: py - m.T - uy * z }));
  };

  const stagePoint = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onTap = (x: number, y: number) => {
    const zone = x / (box.W || 1);
    if (s.tapZones && zoomRef.current.z <= 1.01 && (zone < 0.28 || zone > 0.72)) return visual(zone < 0.28 ? -1 : 1);
    const now = performance.now();
    const last = lastTap.current;
    if (last && now - last.t < 300 && Math.hypot(x - last.x, y - last.y) < 40) {
      window.clearTimeout(tapTimer.current);
      lastTap.current = null;
      return zoomAround(x, y, zoomRef.current.z > 1.01 ? 1 : 2.5);
    }
    lastTap.current = { t: now, x, y };
    window.clearTimeout(tapTimer.current);
    tapTimer.current = window.setTimeout(() => {
      lastTap.current = null;
      setUi((u) => !u);
    }, 280);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (animating || showEnd) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const p = stagePoint(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const m = measure();
      const z = zoomRef.current;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      pinch.current = m ? { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: z.z, ux: (mx - m.L - z.x) / z.z, uy: (my - m.T - z.y) / z.z } : null;
      drag.current = null;
      if (dx) springBack();
    } else if (pointers.current.size === 1) {
      drag.current = { x0: p.x, y0: p.y, t0: performance.now(), mode: null, px: zoomRef.current.x, py: zoomRef.current.y };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = stagePoint(e);
    pointers.current.set(e.pointerId, p);
    const pn = pinch.current;
    if (pn && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const m = measure();
      if (!m) return;
      const z = clamp(pn.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / pn.d0), 1, 5);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      setZoom(clampPan({ z, x: mx - m.L - pn.ux * z, y: my - m.T - pn.uy * z }));
      return;
    }
    const d = drag.current;
    if (!d) return;
    const ddx = p.x - d.x0;
    const ddy = p.y - d.y0;
    if (!d.mode) {
      if (Math.hypot(ddx, ddy) < 8) return;
      const m = measure();
      const z = zoomRef.current.z;
      const pannableX = !!m && m.w * z > m.W + 1;
      const pannableY = !!m && m.h * z > m.H + 1;
      d.mode = Math.abs(ddx) > Math.abs(ddy) && !pannableX ? "swipe" : pannableX || pannableY ? "pan" : "swipe";
    }
    if (d.mode === "swipe") {
      const side = ddx < 0 ? 1 : -1;
      const dir = (side === 1) === (s.direction === "ltr") ? 1 : -1;
      const blocked = (dir === -1 && spreadIndex <= 0) || (dir === 1 && spreadIndex >= spreads.length - 1);
      setDx(blocked ? ddx * 0.3 : ddx);
    } else {
      setZoom(clampPan({ z: zoomRef.current.z, x: d.px + ddx, y: d.py + ddy }));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = stagePoint(e);
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) {
        pinch.current = null;
        const rest = [...pointers.current.values()][0];
        drag.current = rest ? { x0: rest.x, y0: rest.y, t0: performance.now(), mode: "pan", px: zoomRef.current.x, py: zoomRef.current.y } : null;
      }
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === "swipe") {
      const moved = p.x - d.x0;
      const velocity = moved / Math.max(1, performance.now() - d.t0);
      if (Math.abs(moved) > box.W * 0.18 || (Math.abs(velocity) > 0.45 && Math.abs(moved) > 30)) visual(moved < 0 ? 1 : -1);
      else springBack();
    } else if (!d.mode) onTap(p.x, p.y);
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    drag.current = null;
    pinch.current = null;
    springBack();
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || vertical) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const p = stagePoint(e);
        return zoomAround(p.x, p.y, zoomRef.current.z * Math.exp(-e.deltaY * 0.01));
      }
      const m = measure();
      if (m && m.h * zoomRef.current.z > m.H + 1 && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        const before = zoomRef.current;
        const after = clampPan({ ...before, y: before.y - e.deltaY });
        if (Math.abs(after.y - before.y) > 0.5) return setZoom(after);
      }
      if (performance.now() - lastWheel.current < 350) return;
      lastWheel.current = performance.now();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) > 4) logical(delta > 0 ? 1 : -1);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet || (e.target as HTMLElement | null)?.closest("input:not([type=range]), select, textarea")) return;
      const keys: Record<string, () => void> = {
        ArrowRight: () => (vertical ? logical(1) : visual(1)),
        ArrowLeft: () => (vertical ? logical(-1) : visual(-1)),
        ArrowDown: () => logical(1),
        ArrowUp: () => logical(-1),
        " ": () => logical(e.shiftKey ? -1 : 1),
        PageDown: () => logical(1),
        PageUp: () => logical(-1),
        Home: () => jumpTo(0),
        End: () => jumpTo(pages - 1),
        Escape: () => actions.closeComic(),
        f: toggleFullscreen,
        "+": () => zoomAround(box.W / 2, box.H / 2, zoomRef.current.z * 1.25),
        "=": () => zoomAround(box.W / 2, box.H / 2, zoomRef.current.z * 1.25),
        "-": () => zoomAround(box.W / 2, box.H / 2, zoomRef.current.z / 1.25),
      };
      const run = keys[e.key];
      if (!run) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      run();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // ---------- vertical (webtoon) mode ----------
  useEffect(() => {
    if (!vertical || !source) return;
    const root = scrollRef.current;
    if (!root) return;
    if (!scrolledInitially.current) {
      scrolledInitially.current = true;
      requestAnimationFrame(() => scrollToPage(pageRef.current, false));
    }
    const visible = new Map<number, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) visible.set(Number((entry.target as HTMLElement).dataset.i), entry.intersectionRect.height);
      let best = -1;
      let bestHeight = 0;
      for (const [i, h] of visible) if (h > bestHeight) { best = i; bestHeight = h; }
      if (best >= 0 && best !== pageRef.current) setPage(best);
    }, { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    root.querySelectorAll("[data-i]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [vertical, source, pages]);

  useEffect(() => {
    if (!vertical) scrolledInitially.current = false;
  }, [vertical]);

  if (!comic) return null;
  const visualSlots = s.direction === "ltr" ? [spreadIndex - 1, spreadIndex, spreadIndex + 1] : [spreadIndex + 1, spreadIndex, spreadIndex - 1];
  const current = spreads[spreadIndex] ?? [page];
  const pageLabel = current.length > 1 ? `Pages ${current[0] + 1}–${current[1] + 1} of ${pages}` : `Page ${page + 1} of ${pages || "…"}`;
  const pageImage = (i: number) => {
    const url = urls.get(i);
    if (url) return <img key={i} src={url} alt={`Page ${i + 1}`} draggable={false} />;
    return <div key={i} className="rdLoading">{failed.has(i) ? <span>Couldn't load page {i + 1}</span> : <LoaderCircle className="spin" />}</div>;
  };
  const set = (patch: Partial<ReaderSettings>) => actions.setReaderSettings((old) => ({ ...old, ...patch }));

  return (
    <div ref={rootRef} className={`reader bg-${s.background}`} role="dialog" aria-label={comic.title}
      style={{ "--W": `${box.W}px`, "--H": `${box.H}px` } as CSSProperties}>
      {error ? (
        <div className="rdMessage">
          <p>{error}</p>
          <button className="btn" onClick={() => actions.closeComic()}>Back to comics</button>
        </div>
      ) : !source ? (
        <div className="rdMessage">
          <LoaderCircle className="spin" size={34} />
          <p>Opening {comic.title}{openProgress > 0 ? ` · ${Math.round(openProgress * 100)}%` : "…"}</p>
        </div>
      ) : vertical ? (
        <div className="rdScroll" ref={scrollRef} onClick={() => setUi((u) => !u)}>
          {Array.from({ length: pages }, (_, i) => (
            <div key={i} data-i={i} className="rdVPage" style={{ aspectRatio: sizes[i] ?? "2 / 3" }}>
              {urls.get(i)
                ? <img src={urls.get(i)} alt={`Page ${i + 1}`} draggable={false} onLoad={(e) => {
                    const img = e.currentTarget;
                    if (!sizes[i] && img.naturalWidth) setSizes((old) => ({ ...old, [i]: `${img.naturalWidth} / ${img.naturalHeight}` }));
                  }} />
                : <div className="rdLoading">{failed.has(i) ? <span>Couldn't load page {i + 1}</span> : <LoaderCircle className="spin" />}</div>}
            </div>
          ))}
          <div className="rdVEnd">
            <BookOpenCheck size={28} />
            <b>End of {comic.title}</b>
            {nextComic && <button className="btn primary" onClick={(e) => { e.stopPropagation(); actions.openComic(nextComic.id, { fromStart: true }); }}>Next: {nextComic.title}</button>}
          </div>
        </div>
      ) : (
        <div className="rdStage" ref={stageRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
          <div className="rdStrip" onTransitionEnd={(e) => { if (e.target === e.currentTarget) finishTurn(); }}
            style={{ transform: `translate3d(${-box.W + dx}px, 0, 0)`, transition: animating ? "transform 0.26s cubic-bezier(0.2, 0.8, 0.2, 1)" : "none" }}>
            {visualSlots.map((n, k) => (
              <div key={`spread-${n}`} className={`rdSlot fit-${s.fit}`}>
                {n >= 0 && n < spreads.length && (
                  <div ref={k === 1 ? contentRef : undefined} className={"rdPage" + (spreads[n].length > 1 ? " spread" : "")}
                    style={k === 1 ? { transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.z})` } : undefined}>
                    {(s.direction === "rtl" ? [...spreads[n]].reverse() : spreads[n]).map(pageImage)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showEnd && (
        <div className="rdEnd" onClick={() => setShowEnd(false)}>
          <div className="rdEndCard" onClick={(e) => e.stopPropagation()}>
            <BookOpenCheck size={34} />
            <h2>Finished</h2>
            <p>{comic.title}</p>
            {nextComic && <button className="btn primary wide" onClick={() => actions.openComic(nextComic.id, { fromStart: true })}>Next: {nextComic.title} <ChevronRight size={18} /></button>}
            <button className="btn wide" onClick={() => { setShowEnd(false); jumpTo(0); }}><RotateCcw size={16} /> Read again</button>
            <button className="btn wide" onClick={() => actions.closeComic()}>Back to comics</button>
          </div>
        </div>
      )}

      <div className={"rdChrome" + (ui && !showEnd ? "" : " hidden")}>
        <div className="rdTop" role="toolbar" aria-label="Reader controls">
          <button className="iconBtn" aria-label="Close comic" onClick={() => actions.closeComic()}><ChevronLeft size={26} /></button>
          <div className="rdTitle"><b>{comic.title}</b><small>{pageLabel}</small></div>
          <button className="iconBtn" aria-label="All pages" title="All pages" disabled={!source} onClick={() => setSheet("pages")}><LayoutGrid size={21} /></button>
          <button className="iconBtn" aria-label="Reading settings" title="Reading settings" onClick={() => setSheet("settings")}><Settings2 size={21} /></button>
          <button className="iconBtn" aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen}>{fullscreen ? <Minimize size={21} /> : <Maximize size={21} />}</button>
        </div>
        {pages > 0 && (
          <div className="rdBottom" role="toolbar" aria-label="Page navigation">
            <button className="iconBtn" aria-label={s.direction === "rtl" ? "Next page" : "Previous page"} onClick={() => (vertical ? logical(-1) : visual(-1))}><ChevronLeft size={24} /></button>
            <input type="range" className="range" min={0} max={Math.max(0, pages - 1)} step={1} value={page} aria-label="Page"
              style={{ "--pct": `${pages > 1 ? (page / (pages - 1)) * 100 : 100}%`, direction: s.direction === "rtl" && !vertical ? "rtl" : "ltr" } as CSSProperties}
              onChange={(e) => jumpTo(Number(e.target.value))} />
            <button className="iconBtn" aria-label={s.direction === "rtl" ? "Previous page" : "Next page"} onClick={() => (vertical ? logical(1) : visual(1))}><ChevronRight size={24} /></button>
          </div>
        )}
      </div>

      {sheet === "settings" && (
        <Sheet title="Reading settings" subtitle={comic.title} onClose={() => setSheet(null)}>
          <SettingChips label="Layout" value={s.mode} onPick={(mode) => set({ mode })} options={[["paged", "Single page"], ["double", "Two pages"], ["vertical", "Vertical scroll"]]} />
          <SettingChips label="Reading direction" value={s.direction} onPick={(direction) => set({ direction })} options={[["ltr", "Left to right"], ["rtl", "Right to left (manga)"]]} />
          {!vertical && <SettingChips label="Page fit" value={s.fit} onPick={(fit) => set({ fit })} options={[["screen", "Whole page"], ["width", "Fit width"], ["height", "Fit height"]]} />}
          <SettingChips label="Background" value={s.background} onPick={(background) => set({ background })} options={[["black", "Black"], ["gray", "Gray"], ["white", "White"]]} />
          {!vertical && (
            <div className="sheetRow"><span>Tap screen edges to turn pages</span><Toggle checked={s.tapZones} onChange={(tapZones) => set({ tapZones })} label="Tap to turn" /></div>
          )}
          <div className="sheetRow"><span>Keep screen on while reading</span><Toggle checked={s.keepAwake} onChange={(keepAwake) => set({ keepAwake })} label="Keep screen on" /></div>
          <p className="hint">Swipe or tap the edges to turn pages · pinch or double-tap to zoom · drag to move around a zoomed page.</p>
        </Sheet>
      )}

      {sheet === "pages" && source && (
        <Sheet title="Pages" subtitle={`${pages} pages`} onClose={() => setSheet(null)}>
          <PageGrid source={source} current={page} cache={thumbs.current} onPick={(i) => { setSheet(null); jumpTo(i); }} />
        </Sheet>
      )}
    </div>
  );
}

function SettingChips<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: Array<[T, string]>; onPick: (v: T) => void }) {
  return (
    <div className="readerSetting">
      <span>{label}</span>
      <div className="chips compact">
        {options.map(([v, text]) => <button key={v} className={"chip" + (v === value ? " on" : "")} onClick={() => onPick(v)}>{text}</button>)}
      </div>
    </div>
  );
}

function PageGrid({ source, current, cache, onPick }: { source: ComicSource; current: number; cache: Map<number, string>; onPick: (i: number) => void }) {
  const [, setVersion] = useState(0);
  const grid = useRef<HTMLDivElement | null>(null);
  const queue = useRef<number[]>([]);
  const busy = useRef(0);

  useEffect(() => {
    const root = grid.current?.closest(".sheetBody") ?? null;
    let cancelled = false;
    const pump = () => {
      while (busy.current < 2 && queue.current.length) {
        const i = queue.current.shift()!;
        if (cache.has(i)) continue;
        busy.current++;
        source.getPage(i).then((blob) => makeThumbnail(blob, 220)).then((thumb) => {
          if (cancelled || !thumb) return;
          cache.set(i, URL.createObjectURL(thumb));
          setVersion((v) => v + 1);
        }).catch(() => {}).finally(() => {
          busy.current--;
          pump();
        });
      }
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const i = Number((entry.target as HTMLElement).dataset.page);
        if (entry.isIntersecting && !cache.has(i) && !queue.current.includes(i)) queue.current.push(i);
        if (!entry.isIntersecting) queue.current = queue.current.filter((q) => q !== i);
      }
      pump();
    }, { root, rootMargin: "300px" });
    grid.current?.querySelectorAll("[data-page]").forEach((el) => observer.observe(el));
    grid.current?.querySelector(`[data-page="${current}"]`)?.scrollIntoView({ block: "center" });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [source, cache, current]);

  return (
    <div className="pageGrid" ref={grid}>
      {Array.from({ length: source.pages }, (_, i) => (
        <button key={i} data-page={i} className={"pageThumb" + (i === current ? " on" : "")} onClick={() => onPick(i)}>
          {cache.get(i) ? <img src={cache.get(i)} alt="" /> : <span className="pageThumbEmpty" />}
          <small>{i + 1}</small>
        </button>
      ))}
    </div>
  );
}

