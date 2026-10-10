package com.parkingconcepts.mortimer

import android.content.Intent
import android.content.ComponentName
import android.net.Uri
import android.provider.OpenableColumns
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
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
    var section by remember { mutableStateOf("Home") }
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
            }
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
                currentVideoUri = videos.firstOrNull { it.uri == uri }?.uri
                currentTitle = audio.firstOrNull { it.uri == uri }?.title
                    ?: videos.firstOrNull { it.uri == uri }?.title
                    ?: mediaItem?.mediaMetadata?.title?.toString()?.takeIf { it.isNotBlank() }
                    ?: "Nothing is playing"
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
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                NavChip("Home", section == "Home") { section = "Home" }
                NavChip("Music", section == "Music") { section = "Music" }
                NavChip("Services", section == "Services") { section = "Services" }
            }
            Spacer(Modifier.height(14.dp))
            when (section) {
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
                    Button(onClick = { audioPicker.launch(arrayOf("audio/*")) }, colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color(0xFF111114))) { Text("＋ Add music") }
                    if (audio.isEmpty()) EmptyMessage("Select audio files from your phone, an SD card, or a USB drive.")
                    LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(audio) { item ->
                            MediaRow(item.title, "Local audio") {
                                currentTitle = item.title
                                currentVideoUri = null
                                val selectedIndex = audio.indexOf(item).coerceAtLeast(0)
                                player.setMediaItems(
                                    audio.map { track ->
                                        MediaItem.Builder()
                                            .setMediaId(track.uri.toString())
                                            .setUri(track.uri)
                                            .setMediaMetadata(
                                                MediaMetadata.Builder()
                                                    .setTitle(track.title)
                                                    .setArtist("Local audio")
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
            if (section == "Home" || section == "Services") Spacer(Modifier.weight(1f))
            Card(colors = CardDefaults.cardColors(containerColor = Panel), shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                Column(Modifier.padding(14.dp)) {
                    Text("NOW PLAYING", color = Accent, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                    Text(currentTitle, color = MainText, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                    playbackError?.let { message ->
                        Text(message, color = Color(0xFFFF9A86), fontSize = 12.sp, modifier = Modifier.padding(top = 5.dp))
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                        Button(onClick = { if (player.hasPreviousMediaItem()) player.seekToPreviousMediaItem() }, enabled = player.hasPreviousMediaItem(), colors = ButtonDefaults.buttonColors(containerColor = Panel2)) { Text("Previous") }
                        Button(onClick = { if (player.isPlaying) player.pause() else player.play() }, enabled = player.currentMediaItem != null, colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color(0xFF111114))) { Text(if (isPlaying) "Ⅱ Pause" else "▶ Play") }
                        Button(onClick = { if (player.hasNextMediaItem()) player.seekToNextMediaItem() }, enabled = player.hasNextMediaItem(), colors = ButtonDefaults.buttonColors(containerColor = Panel2)) { Text("Next") }
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
private fun MediaRow(title: String, subtitle: String, onClick: () -> Unit) {
    Card(onClick = onClick, colors = CardDefaults.cardColors(containerColor = Panel), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("♫", color = Accent, fontSize = 20.sp)
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(title, color = MainText, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(subtitle, color = Muted, fontSize = 12.sp)
            }
            Text("Open", color = Accent, fontSize = 12.sp)
        }
    }
}

@Composable
private fun EmptyMessage(text: String) {
    Text(text, color = Muted, fontSize = 13.sp, modifier = Modifier.fillMaxWidth().padding(vertical = 18.dp))
}
