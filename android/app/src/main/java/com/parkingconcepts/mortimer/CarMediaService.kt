package com.parkingconcepts.mortimer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentUris
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.media.MediaBrowserServiceCompat
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

class CarMediaService : MediaBrowserServiceCompat() {
    private lateinit var session: MediaSessionCompat
    private lateinit var player: ExoPlayer

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        player = ExoPlayer.Builder(this).build()
        session = MediaSessionCompat(this, "MortimerPlayer").apply {
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                    MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            )
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    player.play()
                    updatePlaybackState()
                    startForeground(NOTIFICATION_ID, buildNotification("Playing music"))
                }

                override fun onPause() {
                    player.pause()
                    updatePlaybackState()
                    stopForeground(STOP_FOREGROUND_DETACH)
                    getSystemService(NotificationManager::class.java).notify(
                        NOTIFICATION_ID, buildNotification("Playback paused")
                    )
                }

                override fun onStop() {
                    player.stop()
                    updatePlaybackState()
                    stopForeground(STOP_FOREGROUND_REMOVE)
                }

                override fun onSkipToNext() {
                    if (player.hasNextMediaItem()) player.seekToNextMediaItem()
                    player.play()
                }

                override fun onSkipToPrevious() {
                    if (player.hasPreviousMediaItem()) player.seekToPreviousMediaItem()
                    player.play()
                }

                override fun onSeekTo(pos: Long) {
                    player.seekTo(pos)
                    updatePlaybackState()
                }

                override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
                    if (mediaId.isNullOrBlank()) return
                    val uri = Uri.parse(mediaId)
                    val metadata = metadataFor(uri) ?: return
                    session.setMetadata(metadata)
                    player.setMediaItem(MediaItem.fromUri(uri))
                    player.prepare()
                    player.play()
                    updatePlaybackState()
                    startForeground(NOTIFICATION_ID, buildNotification(metadata.description.title?.toString() ?: "Playing music"))
                }
            })
            isActive = true
        }
        sessionToken = session.sessionToken
        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                updatePlaybackState()
                if (isPlaying) {
                    startForeground(NOTIFICATION_ID, buildNotification(session.controller.metadata?.description?.title?.toString() ?: "Playing music"))
                } else {
                    stopForeground(STOP_FOREGROUND_DETACH)
                }
            }

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                mediaItem?.localConfiguration?.uri?.let { uri ->
                    metadataFor(uri)?.let(session::setMetadata)
                }
            }
        })
    }

    override fun onGetRoot(clientPackageName: String, clientUid: Int, rootHints: Bundle?): BrowserRoot {
        return BrowserRoot(ROOT_ID, null)
    }

    override fun onLoadChildren(parentId: String, result: Result<List<MediaBrowserCompat.MediaItem>>) {
        if (!hasAudioPermission()) {
            result.sendResult(emptyList())
            return
        }
        if (parentId == ROOT_ID) {
            result.sendResult(listOf(
                MediaBrowserCompat.MediaItem(
                    MediaDescriptionCompat.Builder()
                        .setMediaId(ALL_MUSIC_ID)
                        .setTitle("All music")
                        .setSubtitle("Audio on this device")
                        .build(),
                    MediaBrowserCompat.MediaItem.FLAG_BROWSABLE
                )
            ))
            return
        }
        if (parentId != ALL_MUSIC_ID) {
            result.sendResult(emptyList())
            return
        }

        val items = mutableListOf<MediaBrowserCompat.MediaItem>()
        val collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM
        )
        try {
            contentResolver.query(
                collection,
                projection,
                "${MediaStore.Audio.Media.IS_MUSIC} != 0",
                null,
                "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC"
            )?.use { cursor ->
                val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
                val titleColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
                val artistColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
                val albumColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idColumn)
                    val uri = ContentUris.withAppendedId(collection, id)
                    val title = cursor.getString(titleColumn) ?: "Unknown title"
                    val artist = cursor.getString(artistColumn) ?: "Unknown artist"
                    val album = cursor.getString(albumColumn) ?: ""
                    items += MediaBrowserCompat.MediaItem(
                        MediaDescriptionCompat.Builder()
                            .setMediaId(uri.toString())
                            .setMediaUri(uri)
                            .setTitle(title)
                            .setSubtitle(artist)
                            .setDescription(album)
                            .build(),
                        MediaBrowserCompat.MediaItem.FLAG_PLAYABLE
                    )
                }
            }
        } catch (_: SecurityException) {
            result.sendResult(emptyList())
            return
        }
        result.sendResult(items)
    }

    private fun metadataFor(uri: Uri): MediaMetadataCompat? {
        if (!hasAudioPermission()) return null
        val projection = arrayOf(
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM
        )
        return try {
            contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
                if (!cursor.moveToFirst()) return null
                val title = cursor.getString(0) ?: "Unknown title"
                val artist = cursor.getString(1) ?: "Unknown artist"
                val album = cursor.getString(2) ?: ""
                MediaMetadataCompat.Builder()
                    .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, uri.toString())
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                    .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
                    .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, 0L)
                    .build()
            }
        } catch (_: SecurityException) {
            null
        }
    }

    private fun hasAudioPermission(): Boolean {
        val permission = if (Build.VERSION.SDK_INT >= 33) {
            android.Manifest.permission.READ_MEDIA_AUDIO
        } else {
            android.Manifest.permission.READ_EXTERNAL_STORAGE
        }
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun updatePlaybackState() {
        val state = when {
            player.isPlaying -> PlaybackStateCompat.STATE_PLAYING
            player.playbackState == Player.STATE_BUFFERING -> PlaybackStateCompat.STATE_BUFFERING
            player.playbackState == Player.STATE_ENDED -> PlaybackStateCompat.STATE_STOPPED
            else -> PlaybackStateCompat.STATE_PAUSED
        }
        session.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or
                        PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_STOP or
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                        PlaybackStateCompat.ACTION_SEEK_TO
                )
                .setState(state, player.currentPosition, if (player.isPlaying) player.playbackParameters.speed else 0f)
                .build()
        )
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Music playback", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(title: String): Notification {
        val openApp = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Mortimer Player")
            .setContentText(title)
            .setContentIntent(openApp)
            .setOngoing(player.isPlaying)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
    }

    override fun onDestroy() {
        session.isActive = false
        session.release()
        player.release()
        super.onDestroy()
    }

    companion object {
        private const val ROOT_ID = "mortimer_root"
        private const val ALL_MUSIC_ID = "all_music"
        private const val CHANNEL_ID = "mortimer_playback"
        private const val NOTIFICATION_ID = 42
    }
}
