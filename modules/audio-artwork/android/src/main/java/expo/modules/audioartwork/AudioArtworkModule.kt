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
  }

  private fun extractArtwork(rawUri: String, trackId: String?): String? {
    val context = appContext.reactContext ?: return null
    val cacheDir = File(context.cacheDir, "artworks")
    if (!cacheDir.exists()) {
      cacheDir.mkdirs()
    }

    val cacheKey = if (!trackId.isNullOrEmpty()) trackId else rawUri.hashCode().toString()
    val cachedFile = File(cacheDir, "$cacheKey.jpg")
    if (cachedFile.exists() && cachedFile.length() > 0) {
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

    // 1. Try MediaMetadataRetriever for embedded picture
    val mmr = MediaMetadataRetriever()
    try {
      var sourceSet = false

      // Try content URI with trackId first if available
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

      // Try raw Uri as Content Uri if rawUri starts with content://
      if (!sourceSet && rawUri.startsWith("content://")) {
        try {
          mmr.setDataSource(context, Uri.parse(rawUri))
          sourceSet = true
        } catch (_: Exception) {}
      }

      // Try file path
      if (!sourceSet) {
        try {
          mmr.setDataSource(cleanPath)
          sourceSet = true
        } catch (_: Exception) {}
      }

      if (sourceSet) {
        val picture = mmr.embeddedPicture
        if (picture != null && picture.isNotEmpty()) {
          FileOutputStream(cachedFile).use { fos ->
            fos.write(picture)
          }
          return "file://${cachedFile.absolutePath}"
        }
      }
    } catch (_: Exception) {
    } finally {
      try {
        mmr.release()
      } catch (_: Exception) {}
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
