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

private data class LocalMedia(val uri: Uri, val title: String, val mime: String)

private fun loadMedia(context: Context, category: String, mime: String): List<LocalMedia> {
    val values = context.getSharedPreferences("mortimer_library", Context.MODE_PRIVATE)
        .getStringSet(category, emptySet()).orEmpty()
    return values.mapNotNull { row ->
        val parts = row.split("\t", limit = 2)
        if (parts.size != 2) null else runCatching {
            LocalMedia(Uri.parse(parts[0]), parts[1], mime)
        }.getOrNull()
    }.sortedBy { it.title.lowercase() }
}

private fun addMediaIfMissing(target: MutableList<LocalMedia>, item: LocalMedia) {
    if (target.none { it.uri == item.uri }) target.add(item)
}

private fun saveMedia(context: Context, category: String, items: List<LocalMedia>) {
    context.getSharedPreferences("mortimer_library", Context.MODE_PRIVATE)
        .edit().putStringSet(category, items.map { "${it.uri}\t${it.title}" }.toSet()).apply()
}

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
    var section by remember { mutableStateOf("Inicio") }
    var currentTitle by remember { mutableStateOf(player.currentMediaItem?.mediaMetadata?.title?.toString() ?: "Nothing is playing") }
    var currentVideoUri by remember { mutableStateOf<Uri?>(null) }
    var isPlaying by remember { mutableStateOf(player.isPlaying) }
    var playbackError by remember { mutableStateOf<String?>(null) }

    val audioPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { uri ->
            rememberPermission(context, uri)
            addMediaIfMissing(audio, LocalMedia(uri, displayName(context, uri, "Audio file"), "audio/*"))
        }
        saveMedia(context, "audio", audio)
    }
    val videoPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { uri ->
            rememberPermission(context, uri)
            addMediaIfMissing(videos, LocalMedia(uri, displayName(context, uri, "Video"), "video/*"))
        }
        saveMedia(context, "videos", videos)
    }
    val bookPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { uri ->
            rememberPermission(context, uri)
            addMediaIfMissing(books, LocalMedia(uri, displayName(context, uri, "Book"), "*/*"))
        }
        saveMedia(context, "books", books)
    }
    val comicPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { uri ->
            rememberPermission(context, uri)
            addMediaIfMissing(comics, LocalMedia(uri, displayName(context, uri, "Comic"), "*/*"))
        }
        saveMedia(context, "comics", comics)
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
                currentTitle = audio.firstOrNull { it.uri == uri }?.title
                    ?: mediaItem?.mediaMetadata?.title?.toString()
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
                NavChip("Inicio", section == "Inicio") { section = "Inicio" }
                NavChip("Music", section == "Music") { section = "Music" }
                NavChip("Services", section == "Services") { section = "Services" }
            }
            Spacer(Modifier.height(14.dp))
            when (section) {
                "Inicio" -> {
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
                                player.setMediaItems(audio.map { MediaItem.fromUri(it.uri) }, selectedIndex, 0L)
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
                            MediaRow(item.title, "Video local") {
                                currentTitle = item.title
                                currentVideoUri = item.uri
                                player.setMediaItem(MediaItem.fromUri(item.uri))
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
            Spacer(Modifier.weight(1f))
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
