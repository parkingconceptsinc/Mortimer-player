import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowDown, ArrowUp, ChevronRight, Clock, Disc3, EllipsisVertical, FilePlus, Film, Folder, FolderOpen, Heart, History,
  ListMusic, ListVideo, Pencil, Play, Plus, Search, Shuffle, Tag, Trash2, TrendingUp, UsersRound, X, type LucideIcon,
} from "lucide-react";
import { usePlayer, type MenuTarget } from "../context";
import { Art, ScreenHeader, TrackRow } from "../components";
import type { Route, SongSort, Track } from "../types";
import {
  albumKey, albumOf, albumOrder, artistOf, compareText, formatTotal, genreOf, matches, sortTracks, UNKNOWN_ARTIST,
} from "../util";

type Group = { name: string; tracks: Track[]; cover?: string; albums: Set<string> };
type AlbumInfo = { key: string; title: string; artist: string; year?: number; cover?: string; tracks: Track[]; addedAt: number };

function useCollections(tracks: Track[]) {
  return useMemo(() => {
    const artists = new Map<string, Group>();
    const genres = new Map<string, Group>();
    const folders = new Map<string, Group>();
    const albums = new Map<string, AlbumInfo & { names: Set<string> }>();
    const songs: Track[] = [];
    const videos: Track[] = [];
    const add = (map: Map<string, Group>, name: string, t: Track) => {
      let g = map.get(name);
      if (!g) map.set(name, (g = { name, tracks: [], albums: new Set() }));
      g.tracks.push(t);
      if (!g.cover && t.cover) g.cover = t.cover;
      if (t.kind === "audio") g.albums.add(albumKey(t));
    };
    for (const t of tracks) {
      add(folders, t.folder, t);
      if (t.kind === "video") {
        videos.push(t);
        continue;
      }
      songs.push(t);
      add(artists, artistOf(t), t);
      add(genres, genreOf(t), t);
      const key = albumKey(t);
      let a = albums.get(key);
      if (!a) albums.set(key, (a = { key, title: albumOf(t), artist: t.albumArtist, tracks: [], addedAt: 0, names: new Set() }));
      a.tracks.push(t);
      a.names.add(artistOf(t));
      a.addedAt = Math.max(a.addedAt, t.addedAt);
      if (!a.cover && t.cover) a.cover = t.cover;
      if (!a.year && t.year) a.year = t.year;
    }
    const albumList: AlbumInfo[] = [];
    for (const a of albums.values()) {
      a.tracks.sort(albumOrder);
      albumList.push({ key: a.key, title: a.title, artist: a.artist || (a.names.size === 1 ? [...a.names][0] : "Various Artists"), year: a.year, cover: a.cover, tracks: a.tracks, addedAt: a.addedAt });
    }
    const byName = (x: Group, y: Group) => compareText(x.name, y.name);
    return {
      songs,
      videos,
      artists: [...artists.values()].sort(byName),
      genres: [...genres.values()].sort(byName),
      folders: [...folders.values()].sort(byName),
      albums: albumList.sort((x, y) => compareText(x.title, y.title)),
      albumMap: new Map(albumList.map((a) => [a.key, a])),
      artistMap: artists,
      genreMap: genres,
      folderMap: folders,
    };
  }, [tracks]);
}

const totalDuration = (list: Track[]) => list.reduce((sum, t) => sum + (t.duration ?? 0), 0);
const countLabel = (list: Track[], noun = "song") => `${list.length} ${noun}${list.length === 1 ? "" : "s"}${totalDuration(list) ? ` · ${formatTotal(totalDuration(list))}` : ""}`;
const folderName = (path: string) => (path ? path.slice(path.lastIndexOf("/") + 1) : "Loose files");

function timeAgo(ts: number) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d ago` : new Date(ts).toLocaleDateString();
}

const SONG_SORTS: Array<[SongSort, string]> = [["title", "Title"], ["artist", "Artist"], ["album", "Album"], ["added", "Date added"], ["duration", "Duration"], ["plays", "Most played"]];

export const Library = memo(function Library({ active }: { active: boolean }) {
  const { routes, actions, tracks, loaded } = usePlayer();
  const route = routes[routes.length - 1];
  const routeKey = JSON.stringify(route);
  const [query, setQuery] = useState("");
  const scroller = useRef<HTMLElement | null>(null);
  const scrollMemory = useRef(new Map<string, number>());
  const lib = useCollections(tracks);

  useEffect(() => setQuery(""), [routeKey]);
  useLayoutEffect(() => {
    if (active && scroller.current) scroller.current.scrollTop = scrollMemory.current.get(routeKey + routes.length) ?? 0;
  }, [routeKey, routes.length, active]);

  const onBack = routes.length > 1 ? () => actions.back() : undefined;
  const q = query.trim().toLowerCase();

  let content: ReactNode;
  let title = "Library";
  let subtitle: string | undefined;
  let searchable = true;

  switch (route.view) {
    case "home":
      subtitle = tracks.length ? `${lib.songs.length} songs · ${lib.artists.length} artists · ${lib.albums.length} albums${lib.videos.length ? ` · ${lib.videos.length} videos` : ""}` : undefined;
      content = !loaded ? <div className="emptyState"><Disc3 className="spin" /><p>Loading your library…</p></div>
        : !tracks.length ? <EmptyLibrary />
        : q ? <SearchResults q={q} lib={lib} />
        : <Home lib={lib} />;
      break;
    case "songs":
      title = "Songs";
      content = <SongsView tracks={lib.songs} q={q} />;
      break;
    case "artists":
      title = "Artists";
      subtitle = `${lib.artists.length} artists`;
      content = <GroupList groups={lib.artists.filter((g) => !q || g.name.toLowerCase().includes(q))} icon={UsersRound} round
        detail={(g) => `${g.albums.size} album${g.albums.size === 1 ? "" : "s"} · ${g.tracks.length} songs`} onOpen={(g) => actions.navigate({ view: "artist", name: g.name })} />;
      break;
    case "artist": {
      const group = lib.artistMap.get(route.name) ?? lib.artistMap.get(route.name || UNKNOWN_ARTIST);
      title = route.name || UNKNOWN_ARTIST;
      content = group ? <ArtistView group={group} albums={lib.albums.filter((a) => a.tracks.some((t) => artistOf(t) === group.name))} q={q} /> : <Missing />;
      break;
    }
    case "albums":
      title = "Albums";
      subtitle = `${lib.albums.length} albums`;
      content = <AlbumGrid albums={lib.albums.filter((a) => !q || a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q))} sortable />;
      break;
    case "album": {
      const album = lib.albumMap.get(route.key);
      title = album?.title ?? "Album";
      searchable = false;
      content = album ? <AlbumView album={album} /> : <Missing />;
      break;
    }
    case "genres":
      title = "Genres";
      content = <GroupList groups={lib.genres.filter((g) => !q || g.name.toLowerCase().includes(q))} icon={Tag}
        detail={(g) => countLabel(g.tracks)} onOpen={(g) => actions.navigate({ view: "genre", name: g.name })} />;
      break;
    case "genre": {
      const group = lib.genreMap.get(route.name);
      title = route.name;
      content = group ? <TrackList tracks={filter(sortTracks(group.tracks, "artist", {}), q)} source={route.name} toolbar collection={{ title: route.name, subtitle: "Genre" }} /> : <Missing />;
      break;
    }
    case "folders":
      title = "Folders";
      content = <GroupList groups={lib.folders.filter((g) => !q || g.name.toLowerCase().includes(q))} icon={Folder} square
        label={(g) => folderName(g.name)} detail={(g) => `${g.name || "Opened as individual files"} · ${g.tracks.length}`} onOpen={(g) => actions.navigate({ view: "folder", path: g.name })} />;
      break;
    case "folder": {
      const group = lib.folderMap.get(route.path);
      title = folderName(route.path);
      subtitle = route.path;
      content = group ? <TrackList tracks={filter([...group.tracks].sort((a, b) => compareText(a.name, b.name)), q)} source={title} toolbar collection={{ title, subtitle: "Folder" }} /> : <Missing />;
      break;
    }
    case "playlists":
      title = "Playlists";
      content = <PlaylistsView q={q} />;
      break;
    case "playlist":
      searchable = false;
      title = "Playlist";
      content = <PlaylistView id={route.id} />;
      break;
    case "favorites":
      title = "Favorites";
      content = <FavoritesView q={q} />;
      break;
    case "recent":
      title = "Recently added";
      content = <TrackList tracks={filter([...tracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 300), q)} source="Recently added" toolbar />;
      break;
    case "top":
      title = "Most played";
      content = <TopView q={q} />;
      break;
    case "history":
      title = "Recently played";
      content = <HistoryView q={q} />;
      break;
  }

  return (
    <section className="screen library" hidden={!active} ref={scroller} onScroll={(e) => scrollMemory.current.set(routeKey + routes.length, e.currentTarget.scrollTop)}>
      <ScreenHeader title={title} subtitle={subtitle} onBack={onBack}>
        {route.view === "home" && (
          <>
            <button className="iconBtn" aria-label="Add folder" title="Add folder" onClick={actions.importFolder}><FolderOpen size={20} /></button>
            <button className="iconBtn" aria-label="Add files" title="Add files" onClick={actions.importFiles}><FilePlus size={20} /></button>
          </>
        )}
      </ScreenHeader>
      {searchable && tracks.length > 0 && (
        <label className="searchBox">
          <Search size={17} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={route.view === "home" ? "Search songs, artists, albums…" : `Search in ${title.toLowerCase()}`} />
          {query && <button className="iconBtn" aria-label="Clear search" onClick={() => setQuery("")}><X size={16} /></button>}
        </label>
      )}
      {content}
    </section>
  );
});

function filter(list: Track[], q: string) {
  return q ? list.filter((t) => matches(t, q)) : list;
}

function Missing() {
  return <div className="emptyState"><p>This item is no longer in your library.</p></div>;
}

function EmptyLibrary() {
  const { actions } = usePlayer();
  return (
    <div className="emptyState welcome">
      <img className="welcomeLogo" src={`${import.meta.env.BASE_URL}logo.png`} alt="6" />
      <h2>Welcome to 6</h2>
      <p>Add a music folder or individual files. Everything stays on this device — tags, album art and playlists included.</p>
      <div className="heroActions">
        <button className="btn primary" onClick={actions.importFolder}><FolderOpen size={18} /> Add music folder</button>
        <button className="btn" onClick={actions.importFiles}><FilePlus size={18} /> Add files</button>
      </div>
      <small>Supports MP3, FLAC, M4A/AAC, OGG/Opus, WAV and MP4/WebM/MKV video (depending on your browser).</small>
    </div>
  );
}

type Lib = ReturnType<typeof useCollections>;

function Home({ lib }: { lib: Lib }) {
  const { actions, favorites, playlists, plays, lastPlayed, trackMap } = usePlayer();
  const topCount = Object.values(plays).filter((n) => n > 0).length;
  const tiles: Array<[Route, string, LucideIcon, number | string]> = [
    [{ view: "songs" }, "Songs", ListMusic, lib.songs.length],
    [{ view: "artists" }, "Artists", UsersRound, lib.artists.length],
    [{ view: "albums" }, "Albums", Disc3, lib.albums.length],
    [{ view: "genres" }, "Genres", Tag, lib.genres.length],
    [{ view: "folders" }, "Folders", Folder, lib.folders.length],
    [{ view: "playlists" }, "Playlists", ListVideo, playlists.length],
    [{ view: "favorites" }, "Favorites", Heart, favorites.size],
    [{ view: "recent" }, "Recently added", Clock, ""],
    [{ view: "top" }, "Most played", TrendingUp, topCount || ""],
    [{ view: "history" }, "Recently played", History, ""],
  ];
  const recentAlbums = [...lib.albums].sort((a, b) => b.addedAt - a.addedAt).slice(0, 14);
  const recentlyPlayed = Object.entries(lastPlayed).sort((a, b) => b[1] - a[1]).map(([id]) => trackMap.get(id)).filter((t): t is Track => !!t).slice(0, 6);

  return (
    <>
      <div className="quickActions">
        <button className="btn primary" onClick={() => actions.playTracks(lib.songs.map((t) => t.id), undefined, { shuffle: true, source: "All songs" })}><Shuffle size={18} /> Shuffle all</button>
        <button className="btn" onClick={() => actions.playTracks(sortTracks(lib.songs, "title", {}).map((t) => t.id), undefined, { shuffle: false, source: "All songs" })}><Play size={18} /> Play all</button>
      </div>
      <div className="tiles">
        {tiles.map(([route, label, Icon, count]) => (
          <button key={label} className="tile" onClick={() => actions.navigate(route)}>
            <Icon size={22} />
            <span>{label}</span>
            {count !== "" && <em>{count}</em>}
          </button>
        ))}
        <button className="tile" onClick={() => actions.goTo("videos")}>
          <Film size={22} />
          <span>Videos</span>
          <em>{lib.videos.length}</em>
        </button>
      </div>
      {recentlyPlayed.length > 0 && (
        <>
          <SectionTitle title="Jump back in" onMore={() => actions.navigate({ view: "history" })} />
          <TrackList tracks={recentlyPlayed} source="Recently played" />
        </>
      )}
      {recentAlbums.length > 0 && (
        <>
          <SectionTitle title="Recently added albums" onMore={() => actions.navigate({ view: "albums" })} />
          <div className="albumRow">{recentAlbums.map((a) => <AlbumCard key={a.key} album={a} />)}</div>
        </>
      )}
    </>
  );
}

function SectionTitle({ title, onMore }: { title: string; onMore?: () => void }) {
  return (
    <div className="sectionTitle">
      <h2>{title}</h2>
      {onMore && <button onClick={onMore}>See all <ChevronRight size={15} /></button>}
    </div>
  );
}

function SearchResults({ q, lib }: { q: string; lib: Lib }) {
  const { actions } = usePlayer();
  const songs = lib.songs.filter((t) => matches(t, q));
  const videos = lib.videos.filter((t) => matches(t, q));
  const artists = lib.artists.filter((g) => g.name.toLowerCase().includes(q)).slice(0, 12);
  const albums = lib.albums.filter((a) => a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)).slice(0, 14);
  if (!songs.length && !videos.length && !artists.length && !albums.length) return <div className="emptyState"><p>No results for “{q}”.</p></div>;
  return (
    <>
      {artists.length > 0 && (
        <>
          <SectionTitle title="Artists" />
          <GroupList groups={artists} icon={UsersRound} round detail={(g) => `${g.tracks.length} songs`} onOpen={(g) => actions.navigate({ view: "artist", name: g.name })} />
        </>
      )}
      {albums.length > 0 && (
        <>
          <SectionTitle title="Albums" />
          <div className="albumRow">{albums.map((a) => <AlbumCard key={a.key} album={a} />)}</div>
        </>
      )}
      {songs.length > 0 && (
        <>
          <SectionTitle title={`Songs · ${songs.length}`} />
          <TrackList tracks={songs} source={`Search: ${q}`} />
        </>
      )}
      {videos.length > 0 && (
        <>
          <SectionTitle title="Videos" />
          <TrackList tracks={videos} source={`Search: ${q}`} />
        </>
      )}
    </>
  );
}

function SongsView({ tracks, q }: { tracks: Track[]; q: string }) {
  const { songSort, plays, actions } = usePlayer();
  const sorted = useMemo(() => sortTracks(tracks, songSort, plays), [tracks, songSort, plays]);
  return (
    <TrackList tracks={filter(sorted, q)} source="All songs" toolbar
      sortControl={
        <select className="select" value={songSort} onChange={(e) => actions.setSongSort(e.target.value as SongSort)} aria-label="Sort songs">
          {SONG_SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      }
      detail={songSort === "plays" ? (t) => `${plays[t.id] ?? 0} plays · ${t.artist || "Unknown artist"}` : undefined}
    />
  );
}

type ListProps = {
  tracks: Track[];
  source: string;
  toolbar?: boolean;
  numbered?: boolean;
  sortControl?: ReactNode;
  detail?: (t: Track) => string;
  collection?: { title: string; subtitle?: string };
  menuFor?: (t: Track, index: number) => MenuTarget;
  trailing?: (t: Track, index: number) => ReactNode;
};

function TrackList({ tracks, source, toolbar, numbered, sortControl, detail, collection, menuFor, trailing }: ListProps) {
  const { current, playing, favorites, actions } = usePlayer();
  const ids = useMemo(() => tracks.map((t) => t.id), [tracks]);
  const [limit, setLimit] = useState(120);
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => setLimit(120), [tracks]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || limit >= tracks.length) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + 300);
    }, { rootMargin: "800px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [limit, tracks.length]);

  const onPlay = useCallback((t: Track) => actions.playTracks(ids, t.id, { source }), [actions, ids, source]);
  const onMenu = useCallback((t: Track, index: number) => {
    actions.openMenu(menuFor ? menuFor(t, index) : { title: t.title, subtitle: [t.artist, t.album].filter(Boolean).join(" · "), ids: [t.id], track: t });
  }, [actions, menuFor]);

  if (!tracks.length) return <div className="emptyState"><p>Nothing here yet.</p></div>;
  return (
    <>
      {toolbar && (
        <div className="listToolbar">
          <button className="btn primary small" onClick={() => actions.playTracks(ids, undefined, { shuffle: false, source })}><Play size={16} fill="currentColor" /> Play</button>
          <button className="btn small" onClick={() => actions.playTracks(ids, undefined, { shuffle: true, source })}><Shuffle size={16} /> Shuffle</button>
          <span className="listMeta">{countLabel(tracks, tracks.every((t) => t.kind === "video") ? "video" : "song")}</span>
          {sortControl}
          {collection && (
            <button className="iconBtn" aria-label="More options" onClick={() => actions.openMenu({ title: collection.title, subtitle: collection.subtitle, ids, cover: tracks.find((t) => t.cover)?.cover })}>
              <EllipsisVertical size={18} />
            </button>
          )}
        </div>
      )}
      <div className="trackList">
        {tracks.slice(0, limit).map((t, i) => (
          <TrackRow key={t.id + ":" + i} track={t} index={i} active={current?.id === t.id} playing={playing} favorite={favorites.has(t.id)}
            number={numbered ? t.trackNo ?? i + 1 : undefined} detail={detail?.(t)} onPlay={onPlay} onMenu={onMenu} trailing={trailing?.(t, i)} />
        ))}
        {limit < tracks.length && <div ref={sentinel} className="sentinel">Loading more…</div>}
      </div>
    </>
  );
}

function GroupList({ groups, icon, round, square, label, detail, onOpen }: {
  groups: Group[]; icon: LucideIcon; round?: boolean; square?: boolean;
  label?: (g: Group) => string; detail: (g: Group) => string; onOpen: (g: Group) => void;
}) {
  const { actions } = usePlayer();
  if (!groups.length) return <div className="emptyState"><p>Nothing here yet.</p></div>;
  return (
    <div className="groupList">
      {groups.map((g) => (
        <div key={g.name} className="groupRow" onClick={() => onOpen(g)}
          onContextMenu={(e) => { e.preventDefault(); actions.openMenu({ title: label?.(g) ?? g.name, subtitle: detail(g), ids: g.tracks.map((t) => t.id), cover: g.cover }); }}>
          <Art src={square ? undefined : g.cover} seed={g.name} icon={icon} round={round} className="groupArt" />
          <div className="trackText"><b>{label?.(g) ?? g.name}</b><small>{detail(g)}</small></div>
          <button className="iconBtn" aria-label="More options" onClick={(e) => { e.stopPropagation(); actions.openMenu({ title: label?.(g) ?? g.name, subtitle: detail(g), ids: g.tracks.map((t) => t.id), cover: g.cover }); }}>
            <EllipsisVertical size={18} />
          </button>
        </div>
      ))}
    </div>
  );
}

function AlbumCard({ album }: { album: AlbumInfo }) {
  const { actions } = usePlayer();
  const menu = () => actions.openMenu({ title: album.title, subtitle: album.artist, ids: album.tracks.map((t) => t.id), cover: album.cover });
  return (
    <div className="albumCard" onClick={() => actions.navigate({ view: "album", key: album.key })} onContextMenu={(e) => { e.preventDefault(); menu(); }}>
      <div className="albumCover">
        <Art src={album.cover} seed={album.title + album.artist} icon={Disc3} />
        <button className="albumPlay" aria-label={`Play ${album.title}`} onClick={(e) => { e.stopPropagation(); actions.playTracks(album.tracks.map((t) => t.id), undefined, { shuffle: false, source: album.title }); }}>
          <Play size={18} fill="currentColor" />
        </button>
      </div>
      <b>{album.title}</b>
      <small>{album.artist}{album.year ? ` · ${album.year}` : ""}</small>
    </div>
  );
}

function AlbumGrid({ albums, sortable }: { albums: AlbumInfo[]; sortable?: boolean }) {
  const [sort, setSort] = useState<"title" | "artist" | "year" | "added">("title");
  const sorted = useMemo(() => {
    const list = [...albums];
    if (sort === "artist") list.sort((a, b) => compareText(a.artist, b.artist) || (a.year ?? 0) - (b.year ?? 0));
    else if (sort === "year") list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    else if (sort === "added") list.sort((a, b) => b.addedAt - a.addedAt);
    return list;
  }, [albums, sort]);
  if (!albums.length) return <div className="emptyState"><p>Nothing here yet.</p></div>;
  return (
    <>
      {sortable && (
        <div className="listToolbar">
          <span className="listMeta">{albums.length} albums</span>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort albums">
            <option value="title">Title</option><option value="artist">Artist</option><option value="year">Year</option><option value="added">Date added</option>
          </select>
        </div>
      )}
      <div className="albumGrid">{sorted.map((a) => <AlbumCard key={a.key} album={a} />)}</div>
    </>
  );
}

function CollectionHero({ cover, round, kicker, title, lines, tracks, source, icon }: {
  cover?: string; round?: boolean; kicker: string; title: string; lines: ReactNode[]; tracks: Track[]; source: string; icon: LucideIcon;
}) {
  const { actions } = usePlayer();
  const ids = tracks.map((t) => t.id);
  return (
    <div className="hero">
      <div className="heroBg" style={cover ? ({ "--cover": `url("${cover}")` } as CSSProperties) : undefined} />
      <Art src={cover} seed={title} icon={icon} round={round} className="heroArt" />
      <div className="heroText">
        <span className="kicker">{kicker}</span>
        <h2>{title}</h2>
        {lines.map((line, i) => <p key={i}>{line}</p>)}
        <div className="heroButtons">
          <button className="btn primary" onClick={() => actions.playTracks(ids, undefined, { shuffle: false, source })}><Play size={18} fill="currentColor" /> Play</button>
          <button className="btn" onClick={() => actions.playTracks(ids, undefined, { shuffle: true, source })}><Shuffle size={18} /> Shuffle</button>
          <button className="iconBtn" aria-label="More options" onClick={() => actions.openMenu({ title, subtitle: kicker, ids, cover })}><EllipsisVertical size={20} /></button>
        </div>
      </div>
    </div>
  );
}

function AlbumView({ album }: { album: AlbumInfo }) {
  const { actions } = usePlayer();
  const artistTracks = album.tracks.map((t) => artistOf(t));
  const multiArtist = new Set(artistTracks).size > 1;
  return (
    <>
      <CollectionHero cover={album.cover} kicker="Album" title={album.title} icon={Disc3} source={album.title} tracks={album.tracks}
        lines={[
          <button className="link" onClick={() => actions.navigate({ view: "artist", name: album.artist === "Various Artists" ? artistTracks[0] : album.artist })}>{album.artist}</button>,
          [album.year, countLabel(album.tracks)].filter(Boolean).join(" · "),
        ]} />
      <TrackList tracks={album.tracks} source={album.title} numbered detail={(t) => (multiArtist ? artistOf(t) : t.genre || artistOf(t))} />
    </>
  );
}

function ArtistView({ group, albums, q }: { group: Group; albums: AlbumInfo[]; q: string }) {
  const tracks = useMemo(() => sortTracks(group.tracks, "album", {}), [group.tracks]);
  return (
    <>
      {!q && <CollectionHero cover={group.cover} round kicker="Artist" title={group.name} icon={UsersRound} source={group.name} tracks={tracks}
        lines={[`${albums.length} album${albums.length === 1 ? "" : "s"} · ${countLabel(tracks)}`]} />}
      {!q && albums.length > 0 && (
        <>
          <SectionTitle title="Albums" />
          <div className="albumRow">{[...albums].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).map((a) => <AlbumCard key={a.key} album={a} />)}</div>
        </>
      )}
      <SectionTitle title="Songs" />
      <TrackList tracks={filter(tracks, q)} source={group.name} />
    </>
  );
}

function PlaylistsView({ q }: { q: string }) {
  const { playlists, trackMap, actions } = usePlayer();
  const create = () => {
    const name = window.prompt("New playlist name")?.trim();
    if (name) actions.navigate({ view: "playlist", id: actions.createPlaylist(name) });
  };
  const shown = playlists.filter((p) => !q || p.name.toLowerCase().includes(q));
  return (
    <>
      <div className="listToolbar"><button className="btn primary small" onClick={create}><Plus size={16} /> New playlist</button><span className="listMeta">{playlists.length} playlists</span></div>
      {!shown.length ? (
        <div className="emptyState"><p>Create playlists here, or use “Add to playlist” from any song, album or the queue.</p></div>
      ) : (
        <div className="groupList">
          {shown.map((p) => {
            const items = p.trackIds.map((id) => trackMap.get(id)).filter((t): t is Track => !!t);
            const cover = items.find((t) => t.cover)?.cover;
            return (
              <div key={p.id} className="groupRow" onClick={() => actions.navigate({ view: "playlist", id: p.id })}>
                <Art src={cover} seed={p.name} icon={ListMusic} className="groupArt" />
                <div className="trackText"><b>{p.name}</b><small>{countLabel(items)}</small></div>
                <ChevronRight size={18} className="muted" />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function PlaylistView({ id }: { id: string }) {
  const { playlists, trackMap, actions } = usePlayer();
  const [editing, setEditing] = useState(false);
  const playlist = playlists.find((p) => p.id === id);
  const items = useMemo(() => (playlist ? playlist.trackIds.map((tid) => trackMap.get(tid)).filter((t): t is Track => !!t) : []), [playlist, trackMap]);
  const menuFor = useCallback((t: Track, index: number): MenuTarget => ({ title: t.title, subtitle: t.artist, ids: [t.id], track: t, playlist: { id, index } }), [id]);
  if (!playlist) return <Missing />;
  return (
    <>
      <CollectionHero cover={items.find((t) => t.cover)?.cover} kicker="Playlist" title={playlist.name} icon={ListMusic} source={playlist.name} tracks={items}
        lines={[countLabel(items)]} />
      <div className="listToolbar">
        <button className="btn small" onClick={() => {
          const name = window.prompt("Rename playlist", playlist.name)?.trim();
          if (name) actions.renamePlaylist(id, name);
        }}><Pencil size={15} /> Rename</button>
        {items.length > 1 && <button className={"btn small" + (editing ? " primary" : "")} onClick={() => setEditing((e) => !e)}>{editing ? "Done" : "Reorder"}</button>}
        <button className="btn small danger" onClick={() => { if (window.confirm(`Delete playlist “${playlist.name}”? Songs stay in your library.`)) actions.deletePlaylist(id); }}><Trash2 size={15} /> Delete</button>
      </div>
      {items.length ? (
        <TrackList tracks={items} source={playlist.name} menuFor={menuFor}
          trailing={editing ? (_t, i) => (
            <span className="reorder" onClick={(e) => e.stopPropagation()}>
              <button className="iconBtn" aria-label="Move up" disabled={i === 0} onClick={() => actions.movePlaylistItem(id, i, i - 1)}><ArrowUp size={16} /></button>
              <button className="iconBtn" aria-label="Move down" disabled={i === items.length - 1} onClick={() => actions.movePlaylistItem(id, i, i + 1)}><ArrowDown size={16} /></button>
            </span>
          ) : undefined} />
      ) : (
        <div className="emptyState"><p>This playlist is empty. Use “Add to playlist” from any song or album.</p></div>
      )}
    </>
  );
}

function FavoritesView({ q }: { q: string }) {
  const { favorites, trackMap } = usePlayer();
  const items = [...favorites].map((id) => trackMap.get(id)).filter((t): t is Track => !!t).reverse();
  if (!items.length) return <div className="emptyState"><Heart /><p>Tap the heart on the player or use “Add to favorites” to collect songs here.</p></div>;
  return <TrackList tracks={filter(items, q)} source="Favorites" toolbar collection={{ title: "Favorites" }} />;
}

function TopView({ q }: { q: string }) {
  const { plays, trackMap } = usePlayer();
  const items = Object.entries(plays).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([id]) => trackMap.get(id)).filter((t): t is Track => !!t).slice(0, 100);
  if (!items.length) return <div className="emptyState"><TrendingUp /><p>Your most played songs will appear here.</p></div>;
  return <TrackList tracks={filter(items, q)} source="Most played" toolbar detail={(t) => `${plays[t.id]} plays · ${t.artist || "Unknown artist"}`} />;
}

function HistoryView({ q }: { q: string }) {
  const { lastPlayed, trackMap } = usePlayer();
  const items = Object.entries(lastPlayed).sort((a, b) => b[1] - a[1]).map(([id]) => trackMap.get(id)).filter((t): t is Track => !!t).slice(0, 100);
  if (!items.length) return <div className="emptyState"><History /><p>Songs you play will show up here.</p></div>;
  return <TrackList tracks={filter(items, q)} source="Recently played" toolbar detail={(t) => `${timeAgo(lastPlayed[t.id])} · ${t.artist || "Unknown artist"}`} />;
}
