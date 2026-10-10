package com.parkingconcepts.mortimer

import android.content.Intent
import android.content.ComponentName
import android.net.Uri
import android.provider.OpenableColumns
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.activity.result.contract.ActivityResultContracts
import androidx.documentfile.provider.DocumentFile
import android.media.MediaMetadataRetriever
import android.media.AudioManager
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.PlayerView
import android.content.Context
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.PlaybackException
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors

private val Bg = Color(0xFF07070A)
private val Panel = Color(0xFF121218)
private val Panel2 = Color(0xFF1A1A22)
private val Accent = Color(0xFFFF7849)
private val MainText = Color(0xFFF4F4F6)
private val Muted = Color(0xFF8F8F9C)

class MainActivity : ComponentActivity() {
    private var controllerFuture: ListenableFuture<MediaController>? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(
                background = Bg, surface = Panel, primary = Accent,
                onBackground = MainText, onSurface = MainText
            )) {
                Surface(Modifier.fillMaxSize(), color = Bg) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("Starting Mortimer Player…", color = MainText)
                    }
                }
            }
        }
        val token = SessionToken(this, ComponentName(this, PlaybackService::class.java))
        controllerFuture = MediaController.Builder(this, token).buildAsync().also { future ->
            future.addListener({
                runCatching { future.get() }.onSuccess { controller ->
                    if (!isFinishing && !isDestroyed) {
                        setContent {
                            MaterialTheme(colorScheme = darkColorScheme(
                                background = Bg, surface = Panel, primary = Accent,
                                onBackground = MainText, onSurface = MainText
                            )) {
                                MortimerApp(player = controller, openSpotify = { launchSpotify() }, openExternal = { uri, mime -> openExternal(uri, mime) })
                            }
                        }
                    }
                }.onFailure {
                    if (!isFinishing && !isDestroyed) {
                        setContent {
                            Surface(Modifier.fillMaxSize(), color = Bg) {
                                Text("Could not start the player. Close and reopen Mortimer Player.", color = MainText, modifier = Modifier.padding(24.dp))
                            }
                        }
                    }
                }
            }, MoreExecutors.directExecutor())
        }
    }

    private fun launchSpotify() {
        val spotify = packageManager.getLaunchIntentForPackage("com.spotify.music")
        if (spotify != null) startActivity(spotify)
        else startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://open.spotify.com/")))
    }

    private fun openExternal(uri: Uri, mime: String) {
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            })
        }
    }

    override fun onDestroy() {
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controllerFuture = null
        super.onDestroy()
    }
}

private data class LocalMedia(
    val uri: Uri,
    val title: String,
    val mime: String,
    val artist: String = "Unknown artist",
    val album: String = "",
    val genre: String = "",
    val year: Int = 0,
    val folder: String = "",
    val durationMs: Long = 0L,
    val coverPath: String = "",
    val addedAt: Long = System.currentTimeMillis()
)

private data class LocalPlaylist(
    val id: String,
    val name: String,
    val uris: List<String>,
    val createdAt: Long = System.currentTimeMillis()
)

private fun safeField(value: String): String = value.replace('\t', ' ').replace('\n', ' ').replace('\r', ' ')

private fun loadMedia(context: Context, category: String, mime: String): List<LocalMedia> {
    val values = context.getSharedPreferences("mortimer_library", Context.MODE_PRIVATE)
        .getStringSet(category, emptySet()).orEmpty()
    return values.mapNotNull { row ->
        val parts = row.split('\t')
        if (parts.size < 2 || parts[0].isBlank()) null else runCatching {
            LocalMedia(
                uri = Uri.parse(parts[0]),
                title = parts[1].ifBlank { "Unknown title" },
                mime = mime,
                artist = parts.getOrNull(2)?.ifBlank { "Unknown artist" } ?: "Unknown artist",
                album = parts.getOrNull(3).orEmpty(),
                genre = parts.getOrNull(4).orEmpty(),
                year = parts.getOrNull(5)?.toIntOrNull() ?: 0,
                folder = parts.getOrNull(6).orEmpty(),
                durationMs = parts.getOrNull(7)?.toLongOrNull() ?: 0L,
                coverPath = parts.getOrNull(8).orEmpty(),
                addedAt = parts.getOrNull(9)?.toLongOrNull() ?: System.currentTimeMillis()
            )
        }.getOrNull()
    }.sortedBy { it.title.lowercase() }
}

private fun addMediaIfMissing(target: MutableList<LocalMedia>, item: LocalMedia) {
    val index = target.indexOfFirst { it.uri == item.uri }
    if (index < 0) target.add(item) else target[index] = item
}

private fun saveMedia(context: Context, category: String, items: List<LocalMedia>) {
    val rows = items.map { item ->
        listOf(
            item.uri.toString(), item.title, item.artist, item.album, item.genre,
            item.year.toString(), item.folder, item.durationMs.toString(),
            item.coverPath, item.addedAt.toString()
        ).joinToString("\t", transform = ::safeField)
    }.toSet()
    context.getSharedPreferences("mortimer_library", Context.MODE_PRIVATE)
        .edit().putStringSet(category, rows).apply()
}

private fun enrichMediaMetadata(context: Context, item: LocalMedia): LocalMedia {
    val retriever = MediaMetadataRetriever()
    return try {
        retriever.setDataSource(context, item.uri)
        val title = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)
            ?.trim()?.takeIf { it.isNotBlank() } ?: item.title
        val artist = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
            ?.trim()?.takeIf { it.isNotBlank() } ?: item.artist
        val album = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)
            ?.trim()?.takeIf { it.isNotBlank() } ?: item.album
        val genre = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_GENRE)
            ?.trim()?.takeIf { it.isNotBlank() } ?: item.genre
        val year = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_YEAR)?.toIntOrNull() ?: item.year
        val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
            ?: item.durationMs
        val coverPath = runCatching {
            val art = retriever.embeddedPicture?.takeIf { it.isNotEmpty() && it.size <= MAX_EMBEDDED_ART_BYTES }
            if (art == null) item.coverPath else {
                val dir = File(context.filesDir, "album-art")
                if (!dir.exists()) dir.mkdirs()
                val destination = File(dir, "${item.uri.toString().hashCode().toUInt().toString(16)}.jpg")
                destination.writeBytes(art)
                destination.absolutePath
            }
        }.getOrDefault(item.coverPath)
        item.copy(title = title, artist = artist, album = album, genre = genre, year = year,
            durationMs = duration, coverPath = coverPath)
    } catch (_: Exception) {
        item
    } finally {
        runCatching { retriever.release() }
    }
}

private fun loadStringList(context: Context, key: String): List<String> {
    val raw = context.getSharedPreferences("mortimer_library", Context.MODE_PRIVATE).getString(key, null)
        ?: return emptyList()
    return runCatching {
        val array = JSONArray(raw)
        (0 until array.length()).mapNotNull { array.optString(it).takeIf(String::isNotBlank) }
    }.getOrDefault(emptyList())
}

private fun saveStringList(context: Context, key: String, values: List<String>) {
    val array = JSONArray()
    values.forEach(array::put)
    context.getSharedPreferences("mortimer_library", Context.MODE_PRIVATE).edit().putString(key, array.toString()).apply()
}

private fun loadPlayCounts(context: Context): Map<String, Int> {
    val raw = context.getSharedPreferences("mortimer_library", Context.MODE_PRIVATE).getString("play_counts", null)
        ?: return emptyMap()
    return runCatching {
        val json = JSONObject(raw)
        json.keys().asSequence().associateWith { key -> json.optInt(key, 0) }
    }.getOrDefault(emptyMap())
}

private fun savePlayCounts(context: Context, counts: Map<String, Int>) {
    val json = JSONObject()
    counts.forEach { (uri, count) -> json.put(uri, count) }
    context.getSharedPreferences("mortimer_library", Context.MODE_PRIVATE).edit().putString("play_counts", json.toString()).apply()
}

private fun loadPlaylists(context: Context): List<LocalPlaylist> {
    val raw = context.getSharedPreferences("mortimer_library", Context.MODE_PRIVATE).getString("playlists", null)
        ?: return emptyList()
    return runCatching {
        val array = JSONArray(raw)
        (0 until array.length()).mapNotNull { i ->
            val item = array.optJSONObject(i) ?: return@mapNotNull null
            val uris = item.optJSONArray("uris") ?: JSONArray()
            LocalPlaylist(
                item.optString("id", "playlist_$i"),
                item.optString("name", "Playlist"),
                (0 until uris.length()).mapNotNull { uris.optString(it).takeIf(String::isNotBlank) },
                item.optLong("createdAt", System.currentTimeMillis())
            )
        }
    }.getOrDefault(emptyList())
}

private fun savePlaylists(context: Context, playlists: List<LocalPlaylist>) {
    val array = JSONArray()
    playlists.forEach { playlist ->
        val tracks = JSONArray()
        playlist.uris.forEach(tracks::put)
        array.put(JSONObject().put("id", playlist.id).put("name", playlist.name)
            .put("uris", tracks).put("createdAt", playlist.createdAt))
    }
    context.getSharedPreferences("mortimer_library", Context.MODE_PRIVATE).edit().putString("playlists", array.toString()).apply()
}

private fun collectFolderMedia(context: Context, root: DocumentFile): List<Pair<String, LocalMedia>> {
    val found = mutableListOf<Pair<String, LocalMedia>>()
    fun walk(directory: DocumentFile, parentPath: String) {
        directory.listFiles().forEach { child ->
            if (child.isDirectory) {
                walk(child, listOf(parentPath, child.name.orEmpty()).filter(String::isNotBlank).joinToString("/"))
            } else if (child.isFile) {
                val name = child.name ?: return@forEach
                val lower = name.lowercase()
                val extension = lower.substringAfterLast('.', "")
                val category = when {
                    extension in AUDIO_EXTENSIONS || child.type?.startsWith("audio/") == true -> "audio"
                    extension in VIDEO_EXTENSIONS || child.type?.startsWith("video/") == true -> "videos"
                    extension in setOf("cbz", "cbr") -> "comics"
                    extension in BOOK_EXTENSIONS || child.type == "application/pdf" || child.type == "text/plain" -> "books"
                    else -> null
                } ?: return@forEach
                val mime = child.type ?: mimeForExtension(extension)
                found += category to LocalMedia(
                    uri = child.uri,
                    title = name.substringBeforeLast('.', name),
                    mime = mime,
                    folder = parentPath,
                    addedAt = System.currentTimeMillis()
                )
            }
        }
    }
    walk(root, root.name.orEmpty())
    return found
}

private fun mimeForExtension(extension: String): String = when (extension) {
    "mp3" -> "audio/mpeg"
    "m4a", "m4b" -> "audio/mp4"
    "flac" -> "audio/flac"
    "wav" -> "audio/wav"
    "ogg", "oga" -> "audio/ogg"
    "opus" -> "audio/opus"
    "aac" -> "audio/aac"
    "mp4", "m4v" -> "video/mp4"
    "mkv" -> "video/x-matroska"
    "webm" -> "video/webm"
    "avi" -> "video/x-msvideo"
    "mov" -> "video/quicktime"
    "pdf" -> "application/pdf"
    "epub" -> "application/epub+zip"
    "cbz" -> "application/vnd.comicbook+zip"
    "cbr" -> "application/vnd.comicbook-rar"
    "txt", "md", "markdown" -> "text/plain"
    else -> "*/*"
}

private val AUDIO_EXTENSIONS = setOf("mp3", "m4a", "m4b", "aac", "flac", "wav", "aiff", "aif", "ogg", "oga", "opus", "wma", "ape", "alac", "dsf", "dff", "mid", "midi")
private val VIDEO_EXTENSIONS = setOf("mp4", "mkv", "m4v", "mov", "avi", "webm", "flv", "mpg", "mpeg", "3gp", "ts", "mts", "m2ts", "wmv")
private val BOOK_EXTENSIONS = setOf("pdf", "epub", "txt", "md", "markdown", "log", "nfo", "csv", "tsv", "json", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "srt", "vtt", "ass", "ssa", "sub", "html", "htm", "rtf", "docx", "odt")
private const val MAX_EMBEDDED_ART_BYTES = 4 * 1024 * 1024

private fun displayName(context: Context, uri: Uri, fallback: String): String {
    return runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(cursor.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME)) else null
        }
    }.getOrNull()?.takeIf { it.isNotBlank() } ?: fallback
}

private fun rememberPermission(context: Context, uri: Uri) {
    runCatching {
        context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
}

@Composable
private fun MortimerApp(player: Player, openSpotify: () -> Unit, openExternal: (Uri, String) -> Unit) {
    val context = LocalContext.current
    val audioPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) {
        val permission = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO
            else Manifest.permission.READ_EXTERNAL_STORAGE
        if (ContextCompat.checkSelfPermission(context, permission) != PackageManager.PERMISSION_GRANTED) {
            audioPermissionLauncher.launch(permission)
        }
    }
    val audio = remember { mutableStateListOf<LocalMedia>().apply { addAll(loadMedia(context, "audio", "audio/*")) } }
    val videos = remember { mutableStateListOf<LocalMedia>().apply { addAll(loadMedia(context, "videos", "video/*")) } }
    val books = remember { mutableStateListOf<LocalMedia>().apply { addAll(loadMedia(context, "books", "*/*")) } }
    val comics = remember { mutableStateListOf<LocalMedia>().apply { addAll(loadMedia(context, "comics", "*/*")) } }
    val preferences = remember { context.getSharedPreferences("mortimer_library", Context.MODE_PRIVATE) }
    var section by remember { mutableStateOf(preferences.getString("last_section", "Home") ?: "Home") }
    LaunchedEffect(section) { preferences.edit().putString("last_section", section).apply() }
    var currentTitle by remember { mutableStateOf(player.currentMediaItem?.mediaMetadata?.title?.toString() ?: "Nothing is playing") }
    var currentVideoUri by remember { mutableStateOf<Uri?>(null) }
    var isPlaying by remember { mutableStateOf(player.isPlaying) }
    var playbackError by remember { mutableStateOf<String?>(null) }
    var musicView by remember { mutableStateOf("Songs") }
    var musicSearch by remember { mutableStateOf("") }
    var selectedGroup by remember { mutableStateOf<String?>(null) }
    var sortMode by remember { mutableStateOf("Title") }
    var activePlaylistId by remember { mutableStateOf<String?>(null) }
    val favorites = remember { mutableStateListOf<String>().apply { addAll(preferences.getStringSet("favorites", emptySet()).orEmpty()) } }
    val recentTracks = remember { mutableStateListOf<String>().apply { addAll(loadStringList(context, "recent_tracks")) } }
    val playCounts = remember { mutableStateMapOf<String, Int>().apply { putAll(loadPlayCounts(context)) } }
    var playlists by remember { mutableStateOf(loadPlaylists(context)) }
    var showCreatePlaylist by remember { mutableStateOf(false) }
    var draftPlaylistName by remember { mutableStateOf("") }
    var libraryScanStatus by remember { mutableStateOf<String?>(null) }
    var currentPositionMs by remember { mutableStateOf(0L) }
    var durationMs by remember { mutableStateOf(0L) }
    var seeking by remember { mutableStateOf(false) }
    var seekDraft by remember { mutableStateOf(0f) }
    var speed by remember { mutableStateOf(preferences.getFloat("playback_speed", 1f)) }
    var shuffleEnabled by remember { mutableStateOf(player.shuffleModeEnabled) }
    var repeatMode by remember { mutableStateOf(player.repeatMode) }
    var sleepDeadline by remember { mutableStateOf(preferences.getLong("sleep_deadline", 0L)) }
    var sleepEndOfTrack by remember { mutableStateOf(preferences.getBoolean("sleep_end_of_track", false)) }
    var sleepMinutesRemaining by remember { mutableStateOf(0L) }
    val audioManager = remember { context.getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    var deviceVolume by remember {
        mutableStateOf(audioManager.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() /
            audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1))
    }
    var savedVolume by remember { mutableStateOf(audioManager.getStreamVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)) }
    val coroutineScope = rememberCoroutineScope()

    fun importSelectedFiles(uris: List<Uri>, category: String, target: MutableList<LocalMedia>, mime: String, fallback: String) {
        if (uris.isEmpty()) return
        uris.forEach { rememberPermission(context, it) }
        coroutineScope.launch {
            libraryScanStatus = "Reading media metadata…"
            val prepared = withContext(Dispatchers.IO) {
                uris.map { uri ->
                    val item = LocalMedia(uri, displayName(context, uri, fallback), mime)
                    if (category == "audio" || category == "videos") enrichMediaMetadata(context, item) else item
                }
            }
            prepared.forEach { addMediaIfMissing(target, it) }
            saveMedia(context, category, target)
            libraryScanStatus = "Imported ${prepared.size} file(s)."
        }
    }

    val audioPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        importSelectedFiles(uris, "audio", audio, "audio/*", "Audio file")
    }
    val videoPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        importSelectedFiles(uris, "videos", videos, "video/*", "Video")
    }
    val bookPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        importSelectedFiles(uris, "books", books, "*/*", "Book")
    }
    val comicPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        importSelectedFiles(uris, "comics", comics, "*/*", "Comic")
    }

    val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { treeUri ->
        if (treeUri != null) {
            runCatching {
                context.contentResolver.takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            coroutineScope.launch {
                libraryScanStatus = "Scanning folder and subfolders…"
                try {
                    val scanned = withContext(Dispatchers.IO) {
                        val root = DocumentFile.fromTreeUri(context, treeUri)
                            ?: throw IllegalStateException("Could not open the selected folder.")
                        collectFolderMedia(context, root)
                    }
                    val enriched = withContext(Dispatchers.IO) {
                        scanned.mapIndexed { index, pair ->
                            if (index > 0 && index % 4 == 0) {
                                withContext(kotlinx.coroutines.Dispatchers.Main) {
                                    libraryScanStatus = "Reading metadata: $index of ${scanned.size}…"
                                }
                            }
                            val (category, item) = pair
                            category to if (category == "audio" || category == "videos") enrichMediaMetadata(context, item) else item
                        }
                    }
                    enriched.forEach { (category, item) ->
                        when (category) {
                            "audio" -> addMediaIfMissing(audio, item)
                            "videos" -> addMediaIfMissing(videos, item)
                            "books" -> addMediaIfMissing(books, item)
                            "comics" -> addMediaIfMissing(comics, item)
                        }
                    }
                    saveMedia(context, "audio", audio)
                    saveMedia(context, "videos", videos)
                    saveMedia(context, "books", books)
                    saveMedia(context, "comics", comics)
                    libraryScanStatus = "Folder scan complete: ${enriched.size} media file(s) added."
                } catch (error: Exception) {
                    libraryScanStatus = "Folder scan failed: ${error.localizedMessage ?: "Check folder access and try again."}"
                }
            }
        }
    }

    val latestSleepEndOfTrack by rememberUpdatedState(sleepEndOfTrack)
    val latestSleepDeadline by rememberUpdatedState(sleepDeadline)

    LaunchedEffect(player) {
        player.shuffleModeEnabled = preferences.getBoolean("shuffle_enabled", false)
        player.repeatMode = preferences.getInt("repeat_mode", Player.REPEAT_MODE_OFF)
        player.setPlaybackParameters(PlaybackParameters(speed.coerceIn(0.5f, 3f)))
        while (true) {
            if (!seeking) currentPositionMs = player.currentPosition.coerceAtLeast(0L)
            durationMs = player.duration.takeIf { it > 0L } ?: 0L
            isPlaying = player.isPlaying
            shuffleEnabled = player.shuffleModeEnabled
            repeatMode = player.repeatMode
            sleepMinutesRemaining = if (latestSleepDeadline > 0L) {
                ((latestSleepDeadline - System.currentTimeMillis()).coerceAtLeast(0L) / 60_000L)
            } else 0L
            if (latestSleepDeadline > 0L && System.currentTimeMillis() >= latestSleepDeadline) {
                player.pause()
                sleepDeadline = 0L
                preferences.edit().putLong("sleep_deadline", 0L).apply()
            }
            delay(400)
        }
    }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(playing: Boolean) { isPlaying = playing }
            override fun onPlayerError(error: PlaybackException) {
                playbackError = when (error.errorCode) {
                    PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
                    PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES ->
                        "This device does not support this format or codec."
                    PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND,
                    PlaybackException.ERROR_CODE_IO_NO_PERMISSION ->
                        "Can't access this file. Please import it again."
                    else -> "Could not play this file. Error: " + error.errorCodeName
                }
            }
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                playbackError = null
                val uri = mediaItem?.localConfiguration?.uri
                val uriString = uri?.toString()
                currentVideoUri = videos.firstOrNull { it.uri == uri }?.uri
                currentTitle = audio.firstOrNull { it.uri == uri }?.title
                    ?: videos.firstOrNull { it.uri == uri }?.title
                    ?: mediaItem?.mediaMetadata?.title?.toString()?.takeIf { it.isNotBlank() }
                    ?: "Nothing is playing"

                if (uriString != null && (audio.any { it.uri == uri } || videos.any { it.uri == uri })) {
                    recentTracks.remove(uriString)
                    recentTracks.add(0, uriString)
                    while (recentTracks.size > MAX_RECENT_TRACKS) recentTracks.removeAt(recentTracks.lastIndex)
                    saveStringList(context, "recent_tracks", recentTracks.toList())
                    playCounts[uriString] = (playCounts[uriString] ?: 0) + 1
                    savePlayCounts(context, playCounts.toMap())
                    preferences.edit().putString("last_played_uri", uriString).apply()
                }
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_ENDED && latestSleepEndOfTrack) {
                    player.pause()
                    sleepEndOfTrack = false
                    preferences.edit().putBoolean("sleep_end_of_track", false).apply()
                }
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }

    Surface(Modifier.fillMaxSize(), color = Bg) {
        Column(Modifier.fillMaxSize().padding(horizontal = 18.dp)) {
            Spacer(Modifier.height(24.dp))
            Text("MORTIMER PLAYER", color = Accent, fontSize = 13.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
            Spacer(Modifier.height(6.dp))
            Text(section, color = MainText, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold)
            Text("Your media library", color = Muted, fontSize = 14.sp)
            Spacer(Modifier.height(18.dp))
            BackHandler(enabled = section != "Home" || selectedGroup != null || activePlaylistId != null) {
                when {
                    selectedGroup != null -> selectedGroup = null
                    activePlaylistId != null -> activePlaylistId = null
                    section != "Home" -> section = "Home"
                }
            }
            val navSections = listOf("Home", "Music", "Videos", "Books", "Comics", "Now Playing", "Queue", "Services")
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                items(navSections) { destination ->
                    NavChip(destination, section == destination) {
                        if (section != destination) {
                            selectedGroup = null
                            activePlaylistId = null
                            section = destination
                        }
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            AnimatedContent(
                targetState = section,
                transitionSpec = {
                    val forward = navSections.indexOf(targetState) >= navSections.indexOf(initialState)
                    if (forward) {
                        (fadeIn(animationSpec = tween(220)) +
                            slideInHorizontally(animationSpec = tween(220)) { width -> width / 10 }) togetherWith
                            (fadeOut(animationSpec = tween(160)) +
                                slideOutHorizontally(animationSpec = tween(160)) { width -> -width / 12 })
                    } else {
                        (fadeIn(animationSpec = tween(220)) +
                            slideInHorizontally(animationSpec = tween(220)) { width -> -width / 10 }) togetherWith
                            (fadeOut(animationSpec = tween(160)) +
                                slideOutHorizontally(animationSpec = tween(160)) { width -> width / 12 })
                    }
                },
                label = "section-transition"
            ) { targetSection ->
                when (targetSection) {
                "Home" -> {
                    Text("YOUR LIBRARY", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                    Spacer(Modifier.height(8.dp))
                    HomeCard("♫", "Music", "Files from your phone, SD card, or USB drive", audio.size.toString() + " files") { section = "Music" }
                    HomeCard("▣", "Videos", "Your local videos", videos.size.toString() + " files") { section = "Videos" }
                    HomeCard("▤", "Books", "EPUB, PDF, and other documents", books.size.toString() + " files") { section = "Books" }
                    HomeCard("▧", "Comics", "Select your comic files", comics.size.toString() + " files") { section = "Comics" }
                    HomeCard("♫", "Music services", "Spotify and compatible services", "Connect") { section = "Services" }
                }
                "Music" -> {
                    val viewOptions = listOf("Songs", "Artists", "Albums", "Folders", "Favorites", "Recent", "Top played", "Playlists")
                    val artists = audio.groupBy { it.artist.ifBlank { "Unknown artist" } }.toSortedMap(String.CASE_INSENSITIVE_ORDER)
                    val albums = audio.groupBy { "${it.album.ifBlank { "Unknown album" }} — ${it.artist.ifBlank { "Unknown artist" }}" }
                        .toSortedMap(String.CASE_INSENSITIVE_ORDER)
                    val folders = audio.groupBy {
                        it.folder.ifBlank { it.uri.pathSegments.dropLast(1).takeLast(2).joinToString("/").ifBlank { "Imported files" } }
                    }.toSortedMap(String.CASE_INSENSITIVE_ORDER)
                    val sourceTracks = when (musicView) {
                        "Favorites" -> audio.filter { it.uri.toString() in favorites }
                        "Recent" -> recentTracks.mapNotNull { uri -> audio.firstOrNull { it.uri.toString() == uri } }
                        "Top played" -> audio.sortedWith(compareByDescending<LocalMedia> { playCounts[it.uri.toString()] ?: 0 }.thenBy { it.title.lowercase() })
                        "Artists" -> selectedGroup?.let { group -> audio.filter { it.artist.ifBlank { "Unknown artist" } == group } }.orEmpty()
                        "Albums" -> selectedGroup?.let { group -> albums[group].orEmpty() }.orEmpty()
                        "Folders" -> selectedGroup?.let { group -> folders[group].orEmpty() }.orEmpty()
                        "Playlists" -> activePlaylistId?.let { id -> playlists.firstOrNull { it.id == id }?.uris }
                            ?.mapNotNull { uri -> audio.firstOrNull { it.uri.toString() == uri } }.orEmpty()
                        else -> audio.toList()
                    }
                    val query = musicSearch.trim().lowercase()
                    val matchingTracks = sourceTracks.filter { track ->
                        query.isBlank() || listOf(track.title, track.artist, track.album, track.genre, track.folder, track.uri.toString())
                            .any { it.lowercase().contains(query) }
                    }
                    val displayedTracks = when {
                        musicView == "Recent" && selectedGroup == null -> matchingTracks
                        musicView == "Top played" && selectedGroup == null -> matchingTracks
                        else -> when (sortMode) {
                            "Artist" -> matchingTracks.sortedWith(compareBy<LocalMedia> { it.artist.lowercase() }.thenBy { it.title.lowercase() })
                            "Album" -> matchingTracks.sortedWith(compareBy<LocalMedia> { it.album.lowercase() }.thenBy { it.title.lowercase() })
                            "Added" -> matchingTracks.sortedByDescending { it.addedAt }
                            "Duration" -> matchingTracks.sortedByDescending { it.durationMs }
                            "Plays" -> matchingTracks.sortedByDescending { playCounts[it.uri.toString()] ?: 0 }
                            else -> matchingTracks.sortedBy { it.title.lowercase() }
                        }
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { audioPicker.launch(arrayOf("audio/*")) }, colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color(0xFF111114))) { Text("＋ Add files") }
                        OutlinedButton(onClick = { folderPicker.launch(null) }) { Text("Import folder") }
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = musicSearch,
                        onValueChange = { musicSearch = it },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text("Search songs, artists, albums…") }
                    )
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                        items(viewOptions) { view ->
                            NavChip(view, musicView == view) {
                                musicView = view
                                selectedGroup = null
                                activePlaylistId = null
                                musicSearch = ""
                            }
                        }
                    }
                    if (libraryScanStatus != null) {
                        Text(libraryScanStatus.orEmpty(), color = Muted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 6.dp))
                    }

                    when {
                        musicView == "Artists" && selectedGroup == null -> {
                            LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                val groups = artists.filterKeys { query.isBlank() || it.lowercase().contains(query) }.toList()
                                items(groups, key = { it.first }) { (name, tracks) ->
                                    MediaRow(name, "${tracks.size} songs · ${tracks.map { it.album }.distinct().size} albums") { selectedGroup = name }
                                }
                            }
                        }
                        musicView == "Albums" && selectedGroup == null -> {
                            LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                val groups = albums.filterKeys { query.isBlank() || it.lowercase().contains(query) }.toList()
                                items(groups, key = { it.first }) { (name, tracks) ->
                                    MediaRow(name, "${tracks.size} songs") { selectedGroup = name }
                                }
                            }
                        }
                        musicView == "Folders" && selectedGroup == null -> {
                            LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                val groups = folders.filterKeys { query.isBlank() || it.lowercase().contains(query) }.toList()
                                items(groups, key = { it.first }) { (name, tracks) ->
                                    MediaRow(name, "${tracks.size} songs") { selectedGroup = name }
                                }
                            }
                        }
                        musicView == "Playlists" && activePlaylistId == null -> {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Button(onClick = { draftPlaylistName = ""; showCreatePlaylist = true }) { Text("＋ New playlist") }
                                Text("${playlists.size} playlists", color = Muted, fontSize = 12.sp)
                            }
                            LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                items(playlists, key = { it.id }) { playlist ->
                                    MediaRow(playlist.name, "${playlist.uris.size} tracks") {
                                        activePlaylistId = playlist.id
                                        selectedGroup = null
                                    }
                                }
                            }
                        }
                        else -> {
                            if (selectedGroup != null) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(selectedGroup.orEmpty(), color = Accent, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                                    Text("All ${musicView.lowercase()}", color = Muted, fontSize = 12.sp,
                                        modifier = Modifier.clickable { selectedGroup = null }.padding(8.dp))
                                }
                            }
                            if (musicView == "Playlists" && activePlaylistId != null) {
                                val active = playlists.firstOrNull { it.id == activePlaylistId }
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(active?.name ?: "Playlist", color = MainText, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                    Text("Back", color = Accent, modifier = Modifier.clickable { activePlaylistId = null }.padding(8.dp))
                                }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(5.dp), modifier = Modifier.fillMaxWidth()) {
                                listOf("Title", "Artist", "Album", "Added", "Duration", "Plays").forEach { sort ->
                                    NavChip(sort, sortMode == sort) { sortMode = sort }
                                }
                            }
                            Text("${displayedTracks.size} tracks", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(vertical = 4.dp))
                            if (displayedTracks.isEmpty()) {
                                EmptyMessage(if (audio.isEmpty()) "Your library is empty. Add files or import a folder." else "No tracks match this view.")
                            }
                            LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                items(displayedTracks, key = { it.uri.toString() }) { item ->
                                    var playlistMenuExpanded by remember(item.uri) { mutableStateOf(false) }
                                    val isFavorite = item.uri.toString() in favorites
                                    MediaRow(
                                        item.title,
                                        listOf(item.artist, item.album, formatMediaDuration(item.durationMs)).filter(String::isNotBlank).joinToString(" · "),
                                        trailing = {
                                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                                Text(if (isFavorite) "♥" else "♡", color = if (isFavorite) Accent else Muted,
                                                    modifier = Modifier.clickable {
                                                        if (isFavorite) favorites.remove(item.uri.toString()) else favorites.add(item.uri.toString())
                                                        preferences.edit().putStringSet("favorites", favorites.toSet()).apply()
                                                    }.padding(4.dp))
                                                if (musicView == "Playlists" && activePlaylistId != null) {
                                                    Text("Remove", color = Muted, fontSize = 11.sp, modifier = Modifier.clickable {
                                                        val id = activePlaylistId
                                                        playlists = playlists.map { playlist ->
                                                            if (playlist.id == id) playlist.copy(uris = playlist.uris.filterNot { it == item.uri.toString() }) else playlist
                                                        }
                                                        savePlaylists(context, playlists)
                                                    }.padding(4.dp))
                                                } else if (playlists.isNotEmpty()) {
                                                    Box {
                                                        Text("＋", color = Accent, modifier = Modifier.clickable { playlistMenuExpanded = true }.padding(4.dp))
                                                        DropdownMenu(expanded = playlistMenuExpanded, onDismissRequest = { playlistMenuExpanded = false }) {
                                                            playlists.forEach { playlist ->
                                                                DropdownMenuItem(text = { Text(playlist.name) }, onClick = {
                                                                    playlists = playlists.map { old ->
                                                                        if (old.id == playlist.id && item.uri.toString() !in old.uris) old.copy(uris = old.uris + item.uri.toString()) else old
                                                                    }
                                                                    savePlaylists(context, playlists)
                                                                    playlistMenuExpanded = false
                                                                    libraryScanStatus = "Added to ${playlist.name}."
                                                                })
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    ) {
                                        currentTitle = item.title
                                        currentVideoUri = null
                                        val selectedIndex = displayedTracks.indexOf(item).coerceAtLeast(0)
                                        player.setMediaItems(
                                            displayedTracks.map { track ->
                                                MediaItem.Builder()
                                                    .setMediaId(track.uri.toString())
                                                    .setUri(track.uri)
                                                    .setMediaMetadata(
                                                        MediaMetadata.Builder()
                                                            .setTitle(track.title)
                                                            .setArtist(track.artist)
                                                            .setAlbumTitle(track.album)
                                                            .setGenre(track.genre)
                                                            .setIsBrowsable(false)
                                                            .setIsPlayable(true)
                                                            .build()
                                                    )
                                                    .build()
                                            },
                                            selectedIndex,
                                            0L
                                        )
                                        player.prepare()
                                        player.play()
                                    }
                                }
                            }
                        }
                    }
                }
                "Now Playing" -> {
                    Text("NOW PLAYING", color = Accent, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                    Spacer(Modifier.height(10.dp))
                    Text(currentTitle, color = MainText, fontSize = 24.sp, fontWeight = FontWeight.Bold,
                        maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(if (isPlaying) "Playing" else if (player.currentMediaItem != null) "Paused" else "Nothing is playing",
                        color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Button(onClick = { if (player.hasPreviousMediaItem()) player.seekToPreviousMediaItem() },
                            enabled = player.hasPreviousMediaItem()) { Text("Previous") }
                        Button(onClick = { if (isPlaying) player.pause() else player.play() },
                            enabled = player.currentMediaItem != null,
                            colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color(0xFF111114))) {
                            Text(if (isPlaying) "Pause" else "Play")
                        }
                        Button(onClick = { if (player.hasNextMediaItem()) player.seekToNextMediaItem() },
                            enabled = player.hasNextMediaItem()) { Text("Next") }
                    }
                }
                "Queue" -> {
                    Text("${player.mediaItemCount} items in the playback queue", color = Muted, fontSize = 12.sp,
                        modifier = Modifier.padding(bottom = 8.dp))
                    if (player.mediaItemCount == 0) {
                        EmptyMessage("Your queue is empty. Start playing a file from Music or Videos.")
                    } else {
                        LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            items((0 until player.mediaItemCount).toList(), key = { index -> "${index}:${player.getMediaItemAt(index).mediaId}" }) { index ->
                                val item = player.getMediaItemAt(index)
                                val title = item.mediaMetadata.title?.toString()?.takeIf { it.isNotBlank() } ?: "Untitled media"
                                MediaRow(title, if (index == player.currentMediaItemIndex) "Currently playing" else "Queue position ${index + 1}") {
                                    player.seekTo(index, 0L)
                                    player.prepare()
                                    player.play()
                                }
                            }
                        }
                    }
                }
                "Services" -> {
                    HomeCard("♫", "Spotify", "Open the official Spotify app", "Open") { openSpotify() }
                    Text("Spotify plays in its official app. Mortimer Player uses its built-in player for local files.", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
                }
                "Videos" -> {
                    Button(onClick = { videoPicker.launch(arrayOf("video/*")) }) { Text("＋ Add videos") }
                    if (videos.isEmpty()) EmptyMessage("Select videos from your device, SD card, or USB drive.")
                    LazyColumn(modifier = Modifier.weight(1f)) {
                        items(videos) { item ->
                            MediaRow(item.title, "Local video") {
                                currentTitle = item.title
                                currentVideoUri = item.uri
                                player.setMediaItem(
                                    MediaItem.Builder()
                                        .setMediaId(item.uri.toString())
                                        .setUri(item.uri)
                                        .setMediaMetadata(
                                            MediaMetadata.Builder()
                                                .setTitle(item.title)
                                                .setIsBrowsable(false)
                                                .setIsPlayable(true)
                                                .build()
                                        )
                                        .build()
                                )
                                player.prepare()
                                player.play()
                            }
                        }
                    }
                    if (currentVideoUri != null) {
                        AndroidView(
                            factory = { viewContext -> PlayerView(viewContext).apply { this.player = player; useController = true } },
                            update = { it.player = player },
                            modifier = Modifier.fillMaxWidth().height(220.dp)
                        )
                    }
                }
                "Books" -> {
                    Button(onClick = { bookPicker.launch(arrayOf("application/epub+zip", "application/pdf", "text/plain", "*/*")) }) { Text("＋ Import books") }
                    if (books.isEmpty()) EmptyMessage("Import EPUB, PDF, or other documents. Select a PDF or EPUB to read it in Mortimer Player.")
                    LazyColumn(modifier = Modifier.weight(1f)) { items(books) { item -> MediaRow(item.title, "Selected document") {
                            val lowerTitle = item.title.substringBefore("?").lowercase()
                            when {
                                lowerTitle.endsWith(".pdf") -> runCatching {
                                    context.startActivity(Intent(context, PdfReaderActivity::class.java).apply {
                                        data = item.uri
                                        putExtra(PdfReaderActivity.EXTRA_TITLE, item.title)
                                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                    })
                                }.onFailure { openExternal(item.uri, "application/pdf") }
                                lowerTitle.endsWith(".epub") -> runCatching {
                                    context.startActivity(Intent(context, EpubReaderActivity::class.java).apply {
                                        data = item.uri
                                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                    })
                                }.onFailure { openExternal(item.uri, "application/epub+zip") }
                                else -> openExternal(item.uri, item.mime)
                            }
                        } } }
                }
                "Comics" -> {
                    Button(onClick = { comicPicker.launch(arrayOf("application/zip", "application/x-cbz", "application/pdf", "*/*")) }) { Text("＋ Import comics") }
                    if (comics.isEmpty()) EmptyMessage("Import CBZ files to read them here. CBR files require a compatible app.")
                    LazyColumn(modifier = Modifier.weight(1f)) { items(comics) { item ->
                        MediaRow(item.title, "Comic file") {
                            if (item.title.substringBefore("?").lowercase().endsWith(".cbz")) {
                                runCatching {
                                    context.startActivity(Intent(context, ComicReaderActivity::class.java).apply {
                                        data = item.uri
                                        putExtra(ComicReaderActivity.EXTRA_TITLE, item.title)
                                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                    })
                                }.onFailure { openExternal(item.uri, item.mime) }
                            } else openExternal(item.uri, item.mime)
                        }
                    } }
                }
            }
            if (showCreatePlaylist) {
                AlertDialog(
                    onDismissRequest = { showCreatePlaylist = false },
                    title = { Text("Create playlist") },
                    text = {
                        OutlinedTextField(
                            value = draftPlaylistName,
                            onValueChange = { draftPlaylistName = it },
                            label = { Text("Playlist name") },
                            singleLine = true
                        )
                    },
                    confirmButton = {
                        TextButton(onClick = {
                            val name = draftPlaylistName.trim()
                            if (name.isNotEmpty()) {
                                val seededUris = when {
                                    musicView == "Favorites" -> favorites.toList()
                                    musicView == "Recent" -> recentTracks.toList()
                                    selectedGroup != null && musicView == "Artists" ->
                                        audio.filter { it.artist.ifBlank { "Unknown artist" } == selectedGroup }.map { it.uri.toString() }
                                    selectedGroup != null && musicView == "Albums" ->
                                        audio.filter { "${it.album.ifBlank { "Unknown album" }} — ${it.artist.ifBlank { "Unknown artist" }}" == selectedGroup }.map { it.uri.toString() }
                                    selectedGroup != null && musicView == "Folders" ->
                                        audio.filter { (it.folder.ifBlank { it.uri.pathSegments.dropLast(1).takeLast(2).joinToString("/").ifBlank { "Imported files" } }) == selectedGroup }.map { it.uri.toString() }
                                    musicView == "Playlists" -> emptyList()
                                    else -> audio.map { it.uri.toString() }
                                }.distinct()
                                val newPlaylist = LocalPlaylist("playlist_${System.currentTimeMillis()}", name, seededUris)
                                playlists = playlists + newPlaylist
                                savePlaylists(context, playlists)
                                musicView = "Playlists"
                                activePlaylistId = newPlaylist.id
                                selectedGroup = null
                                libraryScanStatus = "Created playlist: $name"
                            }
                            showCreatePlaylist = false
                        }) { Text("Create") }
                    },
                    dismissButton = {
                        TextButton(onClick = { showCreatePlaylist = false }) { Text("Cancel") }
                    }
                )
            }
            }
            if (section == "Home" || section == "Services") Spacer(Modifier.weight(1f))
            Card(colors = CardDefaults.cardColors(containerColor = Panel), shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("NOW PLAYING", color = Accent, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp, modifier = Modifier.clickable { section = "Now Playing" })
                        Spacer(Modifier.weight(1f))
                        Text(if (sleepEndOfTrack) "Sleep: end of track" else if (sleepDeadline > System.currentTimeMillis()) "Sleep: ${sleepMinutesRemaining}m" else "Sleep off", color = Muted, fontSize = 10.sp)
                    }
                    Text(currentTitle, color = MainText, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                    playbackError?.let { message ->
                        Text(message, color = Color(0xFFFF9A86), fontSize = 12.sp, modifier = Modifier.padding(top = 5.dp))
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                        Text(formatMediaDuration(currentPositionMs), color = Muted, fontSize = 10.sp)
                        Slider(
                            value = if (seeking) seekDraft else if (durationMs > 0L) (currentPositionMs.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f) else 0f,
                            onValueChange = {
                                seeking = true
                                seekDraft = it
                            },
                            onValueChangeFinished = {
                                if (durationMs > 0L) player.seekTo((durationMs * seekDraft).toLong().coerceIn(0L, durationMs))
                                currentPositionMs = (durationMs * seekDraft).toLong().coerceAtLeast(0L)
                                seeking = false
                            },
                            enabled = durationMs > 0L,
                            modifier = Modifier.weight(1f).height(30.dp)
                        )
                        Text(formatMediaDuration(durationMs), color = Muted, fontSize = 10.sp)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                        Button(onClick = { if (player.hasPreviousMediaItem()) player.seekToPreviousMediaItem() }, enabled = player.hasPreviousMediaItem(), colors = ButtonDefaults.buttonColors(containerColor = Panel2), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 5.dp)) { Text("Previous", fontSize = 11.sp) }
                        Button(onClick = { if (player.isPlaying) player.pause() else player.play() }, enabled = player.currentMediaItem != null, colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color(0xFF111114)), contentPadding = PaddingValues(horizontal = 14.dp, vertical = 5.dp)) { Text(if (isPlaying) "Ⅱ Pause" else "▶ Play", fontSize = 11.sp) }
                        Button(onClick = { if (player.hasNextMediaItem()) player.seekToNextMediaItem() }, enabled = player.hasNextMediaItem(), colors = ButtonDefaults.buttonColors(containerColor = Panel2), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 5.dp)) { Text("Next", fontSize = 11.sp) }
                        Spacer(Modifier.weight(1f))
                        Text(if (shuffleEnabled) "Shuffle on" else "Shuffle", color = if (shuffleEnabled) Accent else Muted, fontSize = 11.sp,
                            modifier = Modifier.clickable {
                                shuffleEnabled = !shuffleEnabled
                                player.shuffleModeEnabled = shuffleEnabled
                                preferences.edit().putBoolean("shuffle_enabled", shuffleEnabled).apply()
                            }.padding(5.dp))
                        Text(when (repeatMode) { Player.REPEAT_MODE_ONE -> "Repeat 1"; Player.REPEAT_MODE_ALL -> "Repeat all"; else -> "Repeat off" },
                            color = if (repeatMode == Player.REPEAT_MODE_OFF) Muted else Accent, fontSize = 11.sp,
                            modifier = Modifier.clickable {
                                repeatMode = when (repeatMode) {
                                    Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
                                    Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
                                    else -> Player.REPEAT_MODE_OFF
                                }
                                player.repeatMode = repeatMode
                                preferences.edit().putInt("repeat_mode", repeatMode).apply()
                            }.padding(5.dp))
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Volume", color = Muted, fontSize = 11.sp, modifier = Modifier.width(48.dp))
                        Slider(
                            value = deviceVolume.coerceIn(0f, 1f),
                            onValueChange = { value ->
                                val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
                                val streamVolume = (value * maxVolume).toInt().coerceIn(0, maxVolume)
                                audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, streamVolume, 0)
                                deviceVolume = streamVolume.toFloat() / maxVolume
                                if (streamVolume > 0) savedVolume = streamVolume
                            },
                            modifier = Modifier.weight(1f).height(28.dp)
                        )
                        Text("${(deviceVolume * 100).toInt()}%", color = MainText, fontSize = 10.sp)
                        Text(if (deviceVolume == 0f) "Unmute" else "Mute", color = Accent, fontSize = 10.sp,
                            modifier = Modifier.clickable {
                                val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
                                if (audioManager.getStreamVolume(AudioManager.STREAM_MUSIC) == 0) {
                                    val restore = savedVolume.coerceIn(1, maxVolume)
                                    audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, restore, 0)
                                    deviceVolume = restore.toFloat() / maxVolume
                                } else {
                                    savedVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
                                    audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, 0, 0)
                                    deviceVolume = 0f
                                }
                            }.padding(4.dp))
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Speed", color = Muted, fontSize = 11.sp, modifier = Modifier.width(48.dp))
                        Slider(
                            value = speed.coerceIn(0.5f, 3f),
                            onValueChange = { value ->
                                speed = value
                                player.setPlaybackParameters(PlaybackParameters(value))
                                preferences.edit().putFloat("playback_speed", value).apply()
                            },
                            valueRange = 0.5f..3f,
                            modifier = Modifier.weight(1f).height(28.dp)
                        )
                        Text(String.format(java.util.Locale.US, "%.2fx", speed), color = MainText, fontSize = 10.sp)
                        Text("Sleep", color = Accent, fontSize = 11.sp,
                            modifier = Modifier.clickable {
                                val deadline = when {
                                    sleepEndOfTrack -> {
                                        sleepEndOfTrack = false
                                        0L
                                    }
                                    sleepDeadline > System.currentTimeMillis() -> 0L
                                    else -> System.currentTimeMillis() + 30L * 60L * 1000L
                                }
                                sleepDeadline = deadline
                                preferences.edit().putLong("sleep_deadline", deadline).putBoolean("sleep_end_of_track", sleepEndOfTrack).apply()
                                if (deadline == 0L && !sleepEndOfTrack) libraryScanStatus = "Sleep timer cleared."
                            }.padding(4.dp))
                    }
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                        items(listOf("Off", "15 min", "30 min", "60 min", "End of track")) { option ->
                            NavChip(option, when (option) {
                                "Off" -> sleepDeadline == 0L && !sleepEndOfTrack
                                "End of track" -> sleepEndOfTrack
                                else -> sleepDeadline > System.currentTimeMillis() &&
                                    sleepMinutesRemaining == option.substringBefore(' ').toLongOrNull()
                            }) {
                                when (option) {
                                    "Off" -> {
                                        sleepDeadline = 0L
                                        sleepEndOfTrack = false
                                    }
                                    "End of track" -> {
                                        sleepDeadline = 0L
                                        sleepEndOfTrack = true
                                    }
                                    else -> {
                                        val mins = option.substringBefore(' ').toLongOrNull() ?: 30L
                                        sleepDeadline = System.currentTimeMillis() + mins * 60L * 1000L
                                        sleepEndOfTrack = false
                                    }
                                }
                                preferences.edit().putLong("sleep_deadline", sleepDeadline)
                                    .putBoolean("sleep_end_of_track", sleepEndOfTrack).apply()
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NavChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(Modifier.background(if (selected) Accent else Panel2, RoundedCornerShape(999.dp)).clickable(onClick = onClick).padding(horizontal = 13.dp, vertical = 9.dp), contentAlignment = Alignment.Center) {
        Text(label, color = if (selected) Color(0xFF111114) else MainText, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun HomeCard(icon: String, title: String, subtitle: String, trailing: String, onClick: () -> Unit) {
    Card(onClick = onClick, colors = CardDefaults.cardColors(containerColor = Panel), shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(Modifier.fillMaxWidth().padding(15.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp).background(Panel2, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                Text(icon, color = Accent, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            }
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(title, color = MainText, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Text(subtitle, color = Muted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Text(trailing, color = Accent, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun MediaRow(
    title: String,
    subtitle: String,
    trailing: (@Composable () -> Unit)? = null,
    onClick: () -> Unit
) {
    Card(onClick = onClick, colors = CardDefaults.cardColors(containerColor = Panel), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("♫", color = Accent, fontSize = 20.sp)
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(title, color = MainText, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(subtitle.ifBlank { "Local media" }, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (trailing != null) trailing() else Text("Open", color = Accent, fontSize = 12.sp)
        }
    }
}

private const val MAX_RECENT_TRACKS = 250

private fun formatMediaDuration(durationMs: Long): String {
    if (durationMs <= 0L) return ""
    val totalSeconds = durationMs / 1000L
    return "${totalSeconds / 60}:${(totalSeconds % 60).toString().padStart(2, '0')}"
}

@Composable
private fun EmptyMessage(text: String) {
    Text(text, color = Muted, fontSize = 13.sp, modifier = Modifier.fillMaxWidth().padding(vertical = 18.dp))
}
