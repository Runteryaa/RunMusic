package expo.modules.audioartwork

import android.content.ContentUris
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.net.URLDecoder

class AudioArtworkModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AudioArtwork")

    AsyncFunction("getArtworkAsync") { uri: String, trackId: String? ->
      extractArtwork(uri, trackId)
    }

    AsyncFunction("getBatchArtworksAsync") { items: List<Map<String, String>> ->
      val result = mutableMapOf<String, String>()
      for (item in items) {
        val id = item["id"] ?: continue
        val uri = item["uri"] ?: continue
        val art = extractArtwork(uri, id)
        if (art != null) {
          result[id] = art
        }
      }
      result
    }

    AsyncFunction("getMetadataAsync") { uri: String, trackId: String? ->
      extractTrackMetadata(uri, trackId)
    }

    AsyncFunction("getBatchMetadataAsync") { items: List<Map<String, String>> ->
      extractBatchTrackMetadata(items)
    }
  }

  private fun extractTrackMetadata(rawUri: String, trackId: String?): Map<String, Any?> {
    val context = appContext.reactContext ?: return emptyMap()
    var title: String? = null
    var artist: String? = null
    var album: String? = null
    val idLong = trackId?.toLongOrNull()

    // 1. Try MediaStore if trackId is a valid ID
    if (idLong != null) {
      try {
        val cursor = context.contentResolver.query(
          MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
          arrayOf(
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM
          ),
          "${MediaStore.Audio.Media._ID} = ?",
          arrayOf(idLong.toString()),
          null
        )
        cursor?.use {
          if (it.moveToFirst()) {
            val t = it.getString(it.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE))
            val a = it.getString(it.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST))
            val al = it.getString(it.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM))
            if (!t.isNullOrBlank()) title = t.trim()
            if (!a.isNullOrBlank() && !a.equals("<unknown>", ignoreCase = true)) artist = a.trim()
            if (!al.isNullOrBlank()) album = al.trim()
          }
        }
      } catch (_: Exception) {}
    }

    // 2. Extract artwork and fallback metadata via MMR
    val artwork = extractArtworkAndMetadata(rawUri, trackId) { mmrTitle, mmrArtist, mmrAlbum ->
      if (title.isNullOrBlank() && !mmrTitle.isNullOrBlank()) {
        title = mmrTitle.trim()
      }
      if (artist.isNullOrBlank() && !mmrArtist.isNullOrBlank() && !mmrArtist.equals("<unknown>", ignoreCase = true)) {
        artist = mmrArtist.trim()
      }
      if (album.isNullOrBlank() && !mmrAlbum.isNullOrBlank()) {
        album = mmrAlbum.trim()
      }
    }

    return mapOf(
      "id" to (trackId ?: ""),
      "title" to title,
      "artist" to artist,
      "album" to album,
      "artwork" to artwork
    )
  }

  private fun extractBatchTrackMetadata(items: List<Map<String, String>>): Map<String, Map<String, Any?>> {
    val context = appContext.reactContext ?: return emptyMap()
    val result = mutableMapOf<String, Map<String, Any?>>()
    if (items.isEmpty()) return result

    // 1. Batch query MediaStore for metadata in chunks of 50
    val mediaStoreData = mutableMapOf<String, Triple<String?, String?, String?>>()
    val validIds = items.mapNotNull { it["id"] }
    for (chunk in validIds.chunked(50)) {
      try {
        val placeholders = chunk.joinToString(",") { "?" }
        val cursor = context.contentResolver.query(
          MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
          arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM
          ),
          "${MediaStore.Audio.Media._ID} IN ($placeholders)",
          chunk.toTypedArray(),
          null
        )
        cursor?.use {
          val idCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
          val titleCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
          val artistCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
          val albumCol = it.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
          while (it.moveToNext()) {
            val id = it.getLong(idCol).toString()
            val t = it.getString(titleCol)
            val a = it.getString(artistCol)
            val al = it.getString(albumCol)
            val cleanTitle = if (!t.isNullOrBlank()) t.trim() else null
            val cleanArtist = if (!a.isNullOrBlank() && !a.equals("<unknown>", ignoreCase = true)) a.trim() else null
            val cleanAlbum = if (!al.isNullOrBlank()) al.trim() else null
            mediaStoreData[id] = Triple(cleanTitle, cleanArtist, cleanAlbum)
          }
        }
      } catch (_: Exception) {}
    }

    // 2. Process each item
    for (item in items) {
      val id = item["id"] ?: continue
      val uri = item["uri"] ?: continue
      val ms = mediaStoreData[id]
      var title = ms?.first
      var artist = ms?.second
      var album = ms?.third

      val artwork = extractArtworkAndMetadata(uri, id) { mmrTitle, mmrArtist, mmrAlbum ->
        if (title.isNullOrBlank() && !mmrTitle.isNullOrBlank()) {
          title = mmrTitle.trim()
        }
        if (artist.isNullOrBlank() && !mmrArtist.isNullOrBlank() && !mmrArtist.equals("<unknown>", ignoreCase = true)) {
          artist = mmrArtist.trim()
        }
        if (album.isNullOrBlank() && !mmrAlbum.isNullOrBlank()) {
          album = mmrAlbum.trim()
        }
      }

      result[id] = mapOf(
        "id" to id,
        "title" to title,
        "artist" to artist,
        "album" to album,
        "artwork" to artwork
      )
    }

    return result
  }

  private fun extractArtwork(rawUri: String, trackId: String?): String? {
    return extractArtworkAndMetadata(rawUri, trackId, null)
  }

  private fun extractArtworkAndMetadata(
    rawUri: String,
    trackId: String?,
    onMetadataFound: ((title: String?, artist: String?, album: String?) -> Unit)?
  ): String? {
    val context = appContext.reactContext ?: return null
    val cacheDir = File(context.cacheDir, "artworks")
    if (!cacheDir.exists()) {
      cacheDir.mkdirs()
    }

    val cacheKey = if (!trackId.isNullOrEmpty()) trackId else rawUri.hashCode().toString()
    val cachedFile = File(cacheDir, "$cacheKey.jpg")
    val hasCachedArtwork = cachedFile.exists() && cachedFile.length() > 0

    // If artwork is already cached and metadata is not needed, return cached file immediately
    if (hasCachedArtwork && onMetadataFound == null) {
      return "file://${cachedFile.absolutePath}"
    }

    var cleanPath = rawUri
    if (cleanPath.startsWith("file://")) {
      cleanPath = cleanPath.substring(7)
    }
    try {
      cleanPath = URLDecoder.decode(cleanPath, "UTF-8")
    } catch (_: Exception) {}

    val idLong = trackId?.toLongOrNull()

    // 1. MediaMetadataRetriever
    val mmr = MediaMetadataRetriever()
    var mmrArtworkFound = false
    try {
      var sourceSet = false

      if (idLong != null) {
        try {
          val trackContentUri = ContentUris.withAppendedId(
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            idLong
          )
          mmr.setDataSource(context, trackContentUri)
          sourceSet = true
        } catch (_: Exception) {}
      }

      if (!sourceSet && rawUri.startsWith("content://")) {
        try {
          mmr.setDataSource(context, Uri.parse(rawUri))
          sourceSet = true
        } catch (_: Exception) {}
      }

      if (!sourceSet) {
        try {
          mmr.setDataSource(cleanPath)
          sourceSet = true
        } catch (_: Exception) {}
      }

      if (sourceSet) {
        // Extract metadata tags if requested
        if (onMetadataFound != null) {
          val t = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)
          val a = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
            ?: mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST)
          val al = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)
          onMetadataFound(t, a, al)
        }

        // Extract picture if not yet cached
        if (!hasCachedArtwork) {
          val picture = mmr.embeddedPicture
          if (picture != null && picture.isNotEmpty()) {
            FileOutputStream(cachedFile).use { fos ->
              fos.write(picture)
            }
            mmrArtworkFound = true
          }
        }
      }
    } catch (_: Exception) {
    } finally {
      try {
        mmr.release()
      } catch (_: Exception) {}
    }

    if (hasCachedArtwork || mmrArtworkFound) {
      return "file://${cachedFile.absolutePath}"
    }

    // 2. Android 10+ MediaStore thumbnail via ContentResolver
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && idLong != null) {
      try {
        val trackContentUri = ContentUris.withAppendedId(
          MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
          idLong
        )
        val bitmap = context.contentResolver.loadThumbnail(trackContentUri, Size(512, 512), null)
        FileOutputStream(cachedFile).use { out ->
          bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
        }
        return "file://${cachedFile.absolutePath}"
      } catch (_: Exception) {}
    }

    // 3. Fallback: Search directory for cover.jpg / folder.jpg
    try {
      val audioFile = File(cleanPath)
      val parent = audioFile.parentFile
      if (parent != null && parent.isDirectory) {
        val candidateNames = listOf(
          "cover.jpg", "cover.png", "cover.jpeg",
          "folder.jpg", "folder.png", "folder.jpeg",
          "album.jpg", "album.png", "album.jpeg",
          "front.jpg", "front.png"
        )
        for (name in candidateNames) {
          val candidate = File(parent, name)
          if (candidate.exists() && candidate.length() > 0) {
            return "file://${candidate.absolutePath}"
          }
        }
      }
    } catch (_: Exception) {}

    return null
  }
}
