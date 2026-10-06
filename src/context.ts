import { createContext, useContext, type RefObject } from "react";
import type { EqSettings, Playlist, RepeatMode, Route, Screen, SongSort, Track, VideoFit } from "./types";

export type MenuTarget = {
  title: string;
  subtitle?: string;
  ids: string[];
  track?: Track;
  cover?: string;
  playlist?: { id: string; index: number };
  queueIndex?: number;
};

export type SleepState = { endsAt: number | null; endOfTrack: boolean };

export type Actions = {
  playTracks(ids: string[], startId?: string, options?: { shuffle?: boolean; source?: string }): void;
  togglePlay(): void;
  next(): void;
  prev(): void;
  seek(time: number): void;
  seekBy(delta: number): void;
  jump(index: number): void;
  playNext(ids: string[]): void;
  addToQueue(ids: string[]): void;
  removeFromQueue(index: number): void;
  moveInQueue(from: number, to: number): void;
  clearQueue(): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  setSpeed(speed: number): void;
  setPreservePitch(on: boolean): void;
  setEq(update: (eq: EqSettings) => EqSettings): void;
  setBalance(balance: number): void;
  setBoost(boost: number): void;
  setSkipSeconds(seconds: number): void;
  setResumePosition(on: boolean): void;
  setVideoFit(fit: VideoFit): void;
  setSubtitleSize(size: number): void;
  setShowRemaining(on: boolean): void;
  setAccent(accent: string): void;
  setSongSort(sort: SongSort): void;
  setCustomPresets(update: (presets: Record<string, number[]>) => Record<string, number[]>): void;
  toggleFavorite(ids: string[], force?: boolean): void;
  createPlaylist(name: string, ids?: string[]): string;
  addToPlaylist(playlistId: string, ids: string[]): void;
  removeFromPlaylist(playlistId: string, index: number): void;
  movePlaylistItem(playlistId: string, from: number, to: number): void;
  renamePlaylist(playlistId: string, name: string): void;
  deletePlaylist(playlistId: string): void;
  removeFromLibrary(ids: string[]): void;
  clearLibrary(): void;
  importFolder(): void;
  importFiles(): void;
  setSleep(minutes: number | "track" | null): void;
  cycleAB(): void;
  loadSubtitles(file: File): void;
  install(): void;
  toast(message: string): void;
  openMenu(target: MenuTarget): void;
  goTo(screen: Screen): void;
  navigate(route: Route): void;
  back(): void;
};

export type PlayerState = {
  loaded: boolean;
  tracks: Track[];
  trackMap: Map<string, Track>;
  queue: string[];
  qIndex: number;
  queueSource: string;
  current?: Track;
  playing: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
  speed: number;
  preservePitch: boolean;
  eq: EqSettings;
  customPresets: Record<string, number[]>;
  balance: number;
  boost: number;
  skipSeconds: number;
  resumePosition: boolean;
  videoFit: VideoFit;
  subtitleSize: number;
  showRemaining: boolean;
  accent: string;
  songSort: SongSort;
  favorites: Set<string>;
  plays: Record<string, number>;
  lastPlayed: Record<string, number>;
  playlists: Playlist[];
  screen: Screen;
  routes: Route[];
  sleep: SleepState;
  sleepRemaining: number | null;
  ab: { a: number | null; b: number | null };
  subtitles: { url: string; name: string } | null;
  importing: { done: number; total: number } | null;
  canInstall: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  actions: Actions;
};

export const PlayerContext = createContext<PlayerState | null>(null);
export const ProgressContext = createContext({ currentTime: 0, duration: 0 });

export function usePlayer() {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("usePlayer must be used inside the player");
  return value;
}

export const useProgress = () => useContext(ProgressContext);
