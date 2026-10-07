import type Book from "epubjs/types/book";

export const loadEpub = () => import("epubjs").then((m) => m.default);

export async function openEpub(file: Blob): Promise<Book> {
  const ePub = await loadEpub();
  const book = ePub(await file.arrayBuffer());
  // `opened` also waits for resource replacement; destroying the book before that throws inside epub.js.
  await book.opened;
  await book.ready;
  return book;
}

export async function readEpubInfo(file: Blob): Promise<{ title?: string; author?: string; cover: Blob | null }> {
  const book = await openEpub(file);
  try {
    const meta = await book.loaded.metadata;
    let cover: Blob | null = null;
    const coverUrl = await book.coverUrl().catch(() => null);
    if (coverUrl) cover = await fetch(coverUrl).then((r) => r.blob()).catch(() => null);
    return { title: meta.title?.trim() || undefined, author: meta.creator?.trim() || undefined, cover };
  } finally {
    book.destroy();
  }
}
