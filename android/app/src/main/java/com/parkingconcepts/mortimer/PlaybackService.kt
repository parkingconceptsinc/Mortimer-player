package com.parkingconcepts.mortimer

import android.Manifest
import android.content.ContentUris
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSession.MediaItemsWithStartPosition
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Single Media3 library/session for the app UI and Android Auto.
 * Both clients now control the same ExoPlayer and browse the same library.
 */
class PlaybackService : MediaLibraryService() {
    private var librarySession: MediaLibrarySession? = null
    private lateinit var player: ExoPlayer

    override fun onCreate() {
        super.onCreate()
        player = ExoPlayer.Builder(this).build().apply {
            setAudioAttributes(androidx.media3.common.AudioAttributes.DEFAULT, true)
            setHandleAudioBecomingNoisy(true)
        }
        librarySession = MediaLibrarySession.Builder(this, player, LibraryCallback()).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = librarySession

    private inner class LibraryCallback : MediaLibrarySession.Callback {
        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: MediaLibraryService.LibraryParams?
        ): ListenableFuture<LibraryResult<MediaItem>> {
            val root = MediaItem.Builder()
                .setMediaId(ROOT_ID)
                .setMediaMetadata(
                    MediaMetadata.Builder()
                        .setTitle("Mortimer Player")
                        .setIsBrowsable(true)
                        .setIsPlayable(false)
                        .build()
                )
                .build()
            return Futures.immediateFuture(LibraryResult.ofItem(root, params))
        }

        override fun onGetChildren(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: MediaLibraryService.LibraryParams?
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            if (parentId != ROOT_ID) {
                return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.of(), params))
            }
            val allItems = allAudioUris().map { uri ->
                val title = displayName(uri)
                MediaItem.Builder()
                    .setMediaId(uri.toString())
                    .setUri(uri)
                    .setMediaMetadata(
                        MediaMetadata.Builder()
                            .setTitle(title)
                            .setArtist("Local audio")
                            .setIsBrowsable(false)
                            .setIsPlayable(true)
                            .build()
                    )
                    .build()
            }
            val from = (page * pageSize).coerceIn(0, allItems.size)
            val to = (from + pageSize).coerceAtMost(allItems.size)
            return Futures.immediateFuture(
                LibraryResult.ofItemList(ImmutableList.copyOf(allItems.subList(from, to)), params)
            )
        }

        override fun onGetItem(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String
        ): ListenableFuture<LibraryResult<MediaItem>> {
            val uri = runCatching { Uri.parse(mediaId) }.getOrNull()
            if (uri == null || uri.scheme == null) {
                return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE))
            }
            val item = MediaItem.Builder()
                .setMediaId(uri.toString())
                .setUri(uri)
                .setMediaMetadata(
                    MediaMetadata.Builder()
                        .setTitle(displayName(uri))
                        .setIsBrowsable(false)
                        .setIsPlayable(true)
                        .build()
                )
                .build()
            return Futures.immediateFuture(LibraryResult.ofItem(item, null))
        }

        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: List<MediaItem>
        ): ListenableFuture<List<MediaItem>> {
            val resolved = mediaItems.mapNotNull { item ->
                resolveUri(item)?.let { uri ->
                    MediaItem.Builder()
                        .setMediaId(uri.toString())
                        .setUri(uri)
                        .setMediaMetadata(
                            item.mediaMetadata.buildUpon()
                                .setTitle(item.mediaMetadata.title ?: displayName(uri))
                                .setIsPlayable(true)
                                .build()
                        )
                        .build()
                }
            }
            return Futures.immediateFuture(resolved)
        }

        @OptIn(UnstableApi::class)
        override fun onSetMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: List<MediaItem>,
            startIndex: Int,
            startPositionMs: Long
        ): ListenableFuture<MediaItemsWithStartPosition> {
            // When Android Auto requests one song, expand it into the audio library
            // and preserve the selected song as the queue's starting position.
            if (mediaItems.size == 1) {
                val selectedUri = resolveUri(mediaItems.first())
                // Avoid rescanning the entire audio library when the app selects a
                // single video or another non-audio item.
                if (selectedUri != null && isKnownAudioUri(selectedUri)) {
                    val queueUris = allAudioUris()
                    val selectedIndex = queueUris.indexOf(selectedUri)
                    if (selectedIndex >= 0) {
                        val queue = queueUris.map { uri ->
                            MediaItem.Builder()
                                .setMediaId(uri.toString())
                                .setUri(uri)
                                .setMediaMetadata(
                                    MediaMetadata.Builder()
                                        .setTitle(displayName(uri))
                                        .setArtist("Local audio")
                                        .setIsBrowsable(false)
                                        .setIsPlayable(true)
                                        .build()
                                )
                                .build()
                        }
                        return Futures.immediateFuture(
                            MediaItemsWithStartPosition(queue, selectedIndex, startPositionMs)
                        )
                    }
                }
            }

            return Futures.immediateFuture(
                MediaItemsWithStartPosition(
                    mediaItems.mapNotNull { item ->
                        resolveUri(item)?.let { uri ->
                            MediaItem.Builder()
                                .setMediaId(uri.toString())
                                .setUri(uri)
                                .setMediaMetadata(
                                    item.mediaMetadata.buildUpon()
                                        .setTitle(item.mediaMetadata.title ?: displayName(uri))
                                        .setIsPlayable(true)
                                        .build()
                                )
                                .build()
                        }
                    },
                    startIndex,
                    startPositionMs
                )
            )
        }

        private fun resolveUri(item: MediaItem): Uri? {
            item.localConfiguration?.uri?.let { return it }
            item.requestMetadata.mediaUri?.let { return it }
            val rawId = item.mediaId
            if (!rawId.startsWith("content://") && !rawId.startsWith("file://")) return null
            return runCatching { Uri.parse(rawId) }.getOrNull()
        }
    }

    private fun isKnownAudioUri(uri: Uri): Boolean {
        val rawUri = uri.toString()
        val imported = getSharedPreferences("mortimer_library", MODE_PRIVATE)
            .getStringSet("audio", emptySet()).orEmpty()
        if (imported.any { row -> row.substringBefore('\t') == rawUri }) return true

        // MediaStore audio rows use paths such as /external/audio/media/<id>.
        return uri.authority == "media" && uri.pathSegments.any { it.equals("audio", ignoreCase = true) }
    }

    private fun allAudioUris(): List<Uri> {
        val ordered = linkedSetOf<Uri>()
        if (hasAudioPermission()) {
            val collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
            runCatching {
                contentResolver.query(
                    collection,
                    arrayOf(MediaStore.Audio.Media._ID),
                    "${MediaStore.Audio.Media.IS_MUSIC} != 0",
                    null,
                    "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC"
                )?.use { cursor ->
                    val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                    while (cursor.moveToNext()) {
                        ordered.add(ContentUris.withAppendedId(collection, cursor.getLong(idColumn)))
                    }
                }
            }
        }
        val imported = getSharedPreferences("mortimer_library", MODE_PRIVATE)
            .getStringSet("audio", emptySet()).orEmpty()
            .mapNotNull { row ->
                val parts = row.split('\t', limit = 2)
                if (parts.size == 2 && parts[0].isNotBlank()) parts[0] to parts[1] else null
            }
            .sortedBy { it.second.lowercase() }
        imported.forEach { (rawUri, _) ->
            runCatching { Uri.parse(rawUri) }.getOrNull()?.let(ordered::add)
        }
        return ordered.toList()
    }

    private fun displayName(uri: Uri): String {
        var name = uri.lastPathSegment?.substringAfterLast('/')?.ifBlank { null } ?: "Unknown title"
        runCatching {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    name = cursor.getString(0)?.takeIf { it.isNotBlank() } ?: name
                }
            }
        }
        return name
    }

    private fun hasAudioPermission(): Boolean {
        val permission = if (Build.VERSION.SDK_INT >= 33) {
            Manifest.permission.READ_MEDIA_AUDIO
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
    }

    override fun onDestroy() {
        librarySession?.run {
            player.release()
            release()
        }
        librarySession = null
        super.onDestroy()
    }

    companion object {
        private const val ROOT_ID = "mortimer_root"
    }
}
