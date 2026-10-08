import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FileText, LoaderCircle, Maximize, Minimize, X } from "lucide-react";
import { unzipSync } from "fflate";
import { usePlayer } from "../context";
import { formatSize } from "../util";

function rtfToText(value: string) {
  return value
    .replace(/\\'[0-9a-fA-F]{2}/g, (m) => String.fromCharCode(parseInt(m.slice(2), 16)))
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\tab/g, "\t")
    .replace(/\\u(-?\\d+)\\??/g, (_, n) => String.fromCharCode((Number(n) + 65536) % 65536))
    .replace(/\\[a-zA-Z]+-?\\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\\\/g, "\\")
    .replace(/\\~/g, " ")
    .replace(/\\-/g, "")
    .replace(/\\
/g, "");
}

function xmlToText(xml: string) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const paragraphs = [
    ...Array.from(doc.getElementsByTagNameNS("*", "p")),
    ...Array.from(doc.getElementsByTagNameNS("*", "h")),
  ];
  if (paragraphs.length) return paragraphs.map((p) => p.textContent?.trimEnd() ?? "").filter(Boolean).join("\n\n");
  return doc.documentElement.textContent?.trim() ?? "";
}

async function readDocument(file: Blob, format: string) {
  if (format === "html" || format === "htm") return "";
  if (format === "docx" || format === "odt") {
    const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const target = format === "docx" ? "word/document.xml" : "content.xml";
    const data = archive[target];
    if (!data) throw new Error("The document content could not be found.");
    return xmlToText(new TextDecoder().decode(data));
  }
  const text = await file.text();
  return format === "rtf" ? rtfToText(text) : text;
}

export function TextReader() {
  const { comics, readerId, actions } = usePlayer();
  const book = comics.find((c) => c.id === readerId);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [ui, setUi] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const url = useMemo(() => {
    if (!book || !/\\.(html|htm)$/i.test(book.name)) return null;
    return URL.createObjectURL(book.file);
  }, [book?.id]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    void readDocument(book.file, book.format).then((value) => {
      if (cancelled) return;
      setText(value);
      setReady(true);
    }).catch((e: Error) => {
      if (!cancelled) setError(e.message || "Couldn't open this book.");
    });
    return () => { cancelled = true; };
  }, [book?.id]);

  useEffect(() => {
    if (!book || !bodyRef.current) return;
    bodyRef.current.scrollTop = 0;
  }, [book?.id]);

  useEffect(() => {
    if (!book) return;
    const root = bodyRef.current;
    if (!root) return;
    let last = 0;
    const onScroll = () => {
      const max = root.scrollHeight - root.clientHeight;
      const pct = max > 0 ? root.scrollTop / max : 1;
      if (Date.now() - last < 1500) return;
      last = Date.now();
      actions.setComicProgress(book.id, { page: Math.round(pct * 998), pages: 999, at: Date.now() });
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [book?.id, actions, ready]);

  useEffect(() => {
    if (!book) return;
    const onChange = () => setFullscreen(!!globalThis.document.fullscreenElement);
    globalThis.document.addEventListener("fullscreenchange", onChange);
    return () => globalThis.document.removeEventListener("fullscreenchange", onChange);
  }, [book?.id]);

  useEffect(() => {
    if (!book) return;
    const id = window.setTimeout(() => setUi(false), 2600);
    return () => window.clearTimeout(id);
  }, [document?.id]);

  const toggleFullscreen = () => {
    const host = bodyRef.current?.parentElement;
    if (!host) return;
    if (globalThis.document.fullscreenElement) void globalThis.document.exitFullscreen().catch(() => {});
    else void host.requestFullscreen?.().catch(() => {});
  };

  if (!book) return null;
  const html = /\\.(html|htm)$/i.test(book.name);

  return (
    <div className="reader textReader" role="dialog" aria-label={book.title}>
      <div className={"rdChrome" + (ui ? "" : " hidden")}>
        <div className="rdTop" role="toolbar" aria-label="Document controls">
          <button className="iconBtn" aria-label="Close document" onClick={() => actions.closeComic()}><X size={24} /></button>
          <div className="rdTitle">
            <b>{book.title}</b>
            <small>{book.format.toUpperCase()} · {formatSize(book.size)}</small>
          </div>
          <button className="iconBtn" aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize size={21} /> : <Maximize size={21} />}
          </button>
        </div>
      </div>

      {!ready && !error && (
        <div className="rdMessage"><LoaderCircle className="spin" size={34} /><p>Opening {book.title}…</p></div>
      )}
      {error && (
        <div className="rdMessage">
          <p>{error}</p>
          <button className="btn" onClick={() => actions.closeComic()}>Back</button>
        </div>
      )}
      {ready && html && url && (
        <iframe
          className="textHtml"
          src={url}
          title={book.title}
          sandbox=""
          style={{ border: 0, width: "100%", height: "100%" } as CSSProperties}
        />
      )}
      {ready && !html && (
        <div ref={bodyRef} className="textBody" onPointerDown={() => { setUi(true); }}>
          <article className="textPaper">
            <div className="textHeading"><FileText size={20} /><span>{book.title}</span></div>
            <pre>{text}</pre>
          </article>
        </div>
      )}
    </div>
  );
}
