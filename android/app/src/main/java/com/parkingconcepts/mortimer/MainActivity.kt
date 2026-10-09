package com.parkingconcepts.mortimer

import android.content.Intent
import android.net.Uri
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
import android.content.Context
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

private val Bg = Color(0xFF07070A)
private val Panel = Color(0xFF121218)
private val Panel2 = Color(0xFF1A1A22)
private val Accent = Color(0xFFFF7849)
private val MainText = Color(0xFFF4F4F6)
private val Muted = Color(0xFF8F8F9C)

class MainActivity : ComponentActivity() {
    private var player: ExoPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        player = ExoPlayer.Builder(this).build()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(
                background = Bg, surface = Panel, primary = Accent,
                onBackground = MainText, onSurface = MainText
            )) {
                MortimerApp(player = player!!, openSpotify = { launchSpotify() }, openExternal = { uri, mime -> openExternal(uri, mime) })
            }
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
        player?.release()
        player = null
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

private fun saveMedia(context: Context, category: String, items: List<LocalMedia>) {
    context.getSharedPreferences("mortimer_library", Context.MODE_PRIVATE)
        .edit().putStringSet(category, items.map { "${it.uri}\t${it.title}" }.toSet()).apply()
}

private fun rememberPermission(context: Context, uri: Uri) {
    runCatching {
        context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
}

@Composable
private fun MortimerApp(player: ExoPlayer, openSpotify: () -> Unit, openExternal: (Uri, String) -> Unit) {
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
    var currentTitle by remember { mutableStateOf("Nada se está reproduciendo") }
    var isPlaying by remember { mutableStateOf(false) }

    val audioPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { uri ->
            rememberPermission(context, uri)
            audio.add(LocalMedia(uri, uri.lastPathSegment?.substringAfterLast('/') ?: "Archivo de audio", "audio/*"))
        }
        saveMedia(context, "audio", audio)
    }
    val videoPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { uri ->
            rememberPermission(context, uri)
            videos.add(LocalMedia(uri, uri.lastPathSegment?.substringAfterLast('/') ?: "Vídeo", "video/*"))
        }
        saveMedia(context, "videos", videos)
    }
    val bookPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { uri ->
            rememberPermission(context, uri)
            books.add(LocalMedia(uri, uri.lastPathSegment?.substringAfterLast('/') ?: "Libro", "*/*"))
        }
        saveMedia(context, "books", books)
    }
    val comicPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { uri ->
            rememberPermission(context, uri)
            comics.add(LocalMedia(uri, uri.lastPathSegment?.substringAfterLast('/') ?: "Cómic", "*/*"))
        }
        saveMedia(context, "comics", comics)
    }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(playing: Boolean) { isPlaying = playing }
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                val uri = mediaItem?.localConfiguration?.uri
                currentTitle = audio.firstOrNull { it.uri == uri }?.title
                    ?: mediaItem?.mediaMetadata?.title?.toString()
                    ?: "Nada se está reproduciendo"
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
            Text("Tu biblioteca multimedia", color = Muted, fontSize = 14.sp)
            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                NavChip("Inicio", section == "Inicio") { section = "Inicio" }
                NavChip("Mi música", section == "Mi música") { section = "Mi música" }
                NavChip("Servicios", section == "Servicios") { section = "Servicios" }
            }
            Spacer(Modifier.height(14.dp))
            when (section) {
                "Inicio" -> {
                    Text("TU CONTENIDO", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                    Spacer(Modifier.height(8.dp))
                    HomeCard("♫", "Mi música", "Archivos del teléfono, SD o USB", audio.size.toString() + " archivos") { section = "Mi música" }
                    HomeCard("▣", "Vídeos", "Tus vídeos locales", videos.size.toString() + " archivos") { section = "Vídeos" }
                    HomeCard("▤", "Libros", "EPUB, PDF y otros documentos", books.size.toString() + " archivos") { section = "Libros" }
                    HomeCard("▧", "Cómics", "Selecciona tus archivos de cómic", comics.size.toString() + " archivos") { section = "Cómics" }
                    HomeCard("♫", "Servicios de música", "Spotify y servicios compatibles", "Conectar") { section = "Servicios" }
                }
                "Mi música" -> {
                    Button(onClick = { audioPicker.launch(arrayOf("audio/*")) }, colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color(0xFF111114))) { Text("＋ Añadir música") }
                    if (audio.isEmpty()) EmptyMessage("Elige archivos de audio del teléfono, una tarjeta SD o una memoria USB.")
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(audio) { item ->
                            MediaRow(item.title, "Audio local") {
                                currentTitle = item.title
                                val selectedIndex = audio.indexOf(item).coerceAtLeast(0)
                                player.setMediaItems(audio.map { MediaItem.fromUri(it.uri) }, selectedIndex, 0L)
                                player.prepare()
                                player.play()
                            }
                        }
                    }
                }
                "Servicios" -> {
                    HomeCard("♫", "Spotify", "Abrir la aplicación oficial de Spotify", "Abrir") { openSpotify() }
                    Text("Spotify se reproduce en su aplicación oficial. Mortimer Player utiliza su reproductor nativo para los archivos locales.", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
                }
                "Vídeos" -> {
                    Button(onClick = { videoPicker.launch(arrayOf("video/*")) }) { Text("＋ Añadir vídeos") }
                    if (videos.isEmpty()) EmptyMessage("Selecciona vídeos del dispositivo, SD o USB.")
                    LazyColumn { items(videos) { item -> MediaRow(item.title, "Vídeo local") { openExternal(item.uri, item.mime) } } }
                }
                "Libros" -> {
                    Button(onClick = { bookPicker.launch(arrayOf("application/epub+zip", "application/pdf", "text/plain", "*/*")) }) { Text("＋ Importar libros") }
                    if (books.isEmpty()) EmptyMessage("Importa EPUB, PDF u otros documentos. El lector integrado se desarrollará en la siguiente fase.")
                    LazyColumn { items(books) { item -> MediaRow(item.title, "Documento seleccionado") { openExternal(item.uri, item.mime) } } }
                }
                "Cómics" -> {
                    Button(onClick = { comicPicker.launch(arrayOf("application/zip", "application/x-cbz", "application/pdf", "*/*")) }) { Text("＋ Importar cómics") }
                    if (comics.isEmpty()) EmptyMessage("Selecciona archivos de cómic. El lector integrado CBZ/CBR queda pendiente.")
                    LazyColumn { items(comics) { item -> MediaRow(item.title, "Archivo de cómic") { openExternal(item.uri, item.mime) } } }
                }
            }
            Spacer(Modifier.weight(1f))
            Card(colors = CardDefaults.cardColors(containerColor = Panel), shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                Column(Modifier.padding(14.dp)) {
                    Text("REPRODUCIENDO", color = Accent, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                    Text(currentTitle, color = MainText, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                        Button(onClick = { if (player.isPlaying) player.pause() else player.play() }, colors = ButtonDefaults.buttonColors(containerColor = Accent, contentColor = Color(0xFF111114))) { Text(if (isPlaying) "Ⅱ Pausar" else "▶ Reproducir") }
                        Button(onClick = { if (player.hasNextMediaItem()) player.seekToNextMediaItem() }, colors = ButtonDefaults.buttonColors(containerColor = Panel2)) { Text("Siguiente") }
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
            Text("Abrir", color = Accent, fontSize = 12.sp)
        }
    }
}

@Composable
private fun EmptyMessage(text: String) {
    Text(text, color = Muted, fontSize = 13.sp, modifier = Modifier.fillMaxWidth().padding(vertical = 18.dp))
}
