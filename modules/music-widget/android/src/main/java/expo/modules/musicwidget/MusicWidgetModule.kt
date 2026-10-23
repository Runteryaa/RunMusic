package expo.modules.musicwidget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.widget.RemoteViews
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.URL
import java.net.URLDecoder

class MusicWidgetModule : Module() {
  companion object {
    var instance: MusicWidgetModule? = null

    /**
     * Widget artwork is tiny (it is drawn inside a small RemoteViews image).
     * Decoding the full-resolution cover and keeping both the original and
     * rounded copies alive on every track/play-pause update can easily add
     * tens of megabytes to the app heap.
     */
    private const val MAX_WIDGET_ARTWORK_SIZE = 320

    fun sendWidgetAction(action: String) {
      instance?.sendEvent("onWidgetAction", mapOf("action" to action))
    }
  }

  override fun definition() = ModuleDefinition {
    Name("MusicWidget")

    Events("onWidgetAction")

    OnCreate {
      instance = this@MusicWidgetModule
    }

    OnDestroy {
      instance = null
    }

    Function("moveAppToBack") {
      val activity = appContext.currentActivity ?: return@Function false
      activity.moveTaskToBack(true)
    }

    AsyncFunction("updateWidget") { title: String, artist: String, artworkUri: String?, isPlaying: Boolean, bgColorHex: String? ->
      val context = appContext.reactContext ?: return@AsyncFunction
      val appWidgetManager = AppWidgetManager.getInstance(context)

      val comp1x4 = ComponentName(context, MusicWidgetProvider1x4::class.java)
      val ids1x4 = appWidgetManager.getAppWidgetIds(comp1x4)
      val comp2x4 = ComponentName(context, MusicWidgetProvider2x4::class.java)
      val ids2x4 = appWidgetManager.getAppWidgetIds(comp2x4)

      // Do not decode artwork at all when no widget is placed on the home screen.
      if (ids1x4.isEmpty() && ids2x4.isEmpty()) return@AsyncFunction

      val rawBitmap = try {
        decodeWidgetArtwork(context, artworkUri)
      } catch (e: Exception) {
        null
      }

      // RemoteViews only needs the rounded copy. Free the raw decode as soon as
      // the rounded bitmap has been created.
      val roundedBitmap = try {
        rawBitmap?.let { getRoundedCornerBitmap(it, 32f) }
      } finally {
        rawBitmap?.recycle()
      }

      try {
        // Update 1x4
        if (ids1x4.isNotEmpty()) {
          val views = RemoteViews(
            context.packageName,
            context.resources.getIdentifier("widget_1x4", "layout", context.packageName)
          )
          updateViews(context, views, title, artist, roundedBitmap, isPlaying)
          MusicWidgetProvider1x4.updateAppWidget(context, appWidgetManager, ids1x4[0])
          appWidgetManager.updateAppWidget(comp1x4, views)
        }

        // Update 2x4
        if (ids2x4.isNotEmpty()) {
          val views = RemoteViews(
            context.packageName,
            context.resources.getIdentifier("widget_2x4", "layout", context.packageName)
          )
          updateViews(context, views, title, artist, roundedBitmap, isPlaying)
          MusicWidgetProvider2x4.updateAppWidget(context, appWidgetManager, ids2x4[0])
          appWidgetManager.updateAppWidget(comp2x4, views)
        }
      } finally {
        // The RemoteViews bitmap has been parcelled to the launcher by the
        // updateAppWidget calls above; the app-side copy can be released now.
        roundedBitmap?.recycle()
      }
    }
  }

  private fun updateViews(
    context: Context,
    views: RemoteViews,
    title: String,
    artist: String,
    artworkBitmap: Bitmap?,
    isPlaying: Boolean
  ) {
    views.setTextViewText(context.resources.getIdentifier("widget_title", "id", context.packageName), title)
    views.setTextViewText(context.resources.getIdentifier("widget_artist", "id", context.packageName), artist)

    if (artworkBitmap != null) {
      views.setImageViewBitmap(
        context.resources.getIdentifier("widget_artwork", "id", context.packageName),
        artworkBitmap
      )
    } else {
      views.setImageViewResource(
        context.resources.getIdentifier("widget_artwork", "id", context.packageName),
        android.R.color.transparent
      )
    }

    val playPauseBtn = context.resources.getIdentifier("widget_btn_play_pause", "id", context.packageName)
    if (isPlaying) {
      views.setImageViewResource(playPauseBtn, context.resources.getIdentifier("ic_pause", "drawable", context.packageName))
    } else {
      views.setImageViewResource(playPauseBtn, context.resources.getIdentifier("ic_play", "drawable", context.packageName))
    }
  }

  /**
   * Decodes the cover directly at widget size instead of loading a full
   * resolution bitmap first. Content and HTTP URIs are supported as well as
   * local files.
   */
  private fun decodeWidgetArtwork(context: Context, artworkUri: String?): Bitmap? {
    if (artworkUri.isNullOrBlank()) return null

    if (artworkUri.startsWith("http://") || artworkUri.startsWith("https://")) {
      val bytes = URL(artworkUri).openStream().use { it.readBytes() }
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

      val options = BitmapFactory.Options().apply {
        inSampleSize = calculateInSampleSize(bounds.outWidth, bounds.outHeight, MAX_WIDGET_ARTWORK_SIZE)
        inPreferredConfig = Bitmap.Config.ARGB_8888
      }
      val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
      return scaleDownToWidgetSize(decoded)
    }

    if (artworkUri.startsWith("content://")) {
      val uri = Uri.parse(artworkUri)
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      val boundsStream = context.contentResolver.openInputStream(uri) ?: return null
      boundsStream.use { stream ->
        BitmapFactory.decodeStream(stream, null, bounds)
      }
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

      val options = BitmapFactory.Options().apply {
        inSampleSize = calculateInSampleSize(bounds.outWidth, bounds.outHeight, MAX_WIDGET_ARTWORK_SIZE)
        inPreferredConfig = Bitmap.Config.ARGB_8888
      }
      val decoded = context.contentResolver.openInputStream(uri)?.use { stream ->
        BitmapFactory.decodeStream(stream, null, options)
      } ?: return null
      return scaleDownToWidgetSize(decoded)
    }

    var path = if (artworkUri.startsWith("file://")) artworkUri.substring(7) else artworkUri
    path = URLDecoder.decode(path, "UTF-8")
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    val options = BitmapFactory.Options().apply {
      inSampleSize = calculateInSampleSize(bounds.outWidth, bounds.outHeight, MAX_WIDGET_ARTWORK_SIZE)
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val decoded = BitmapFactory.decodeFile(path, options) ?: return null
    return scaleDownToWidgetSize(decoded)
  }

  private fun calculateInSampleSize(width: Int, height: Int, maxSize: Int): Int {
    var sample = 1
    while (width / (sample * 2) >= maxSize && height / (sample * 2) >= maxSize) {
      sample *= 2
    }
    return sample
  }

  private fun scaleDownToWidgetSize(bitmap: Bitmap): Bitmap {
    val width = bitmap.width
    val height = bitmap.height
    if (width <= MAX_WIDGET_ARTWORK_SIZE && height <= MAX_WIDGET_ARTWORK_SIZE) {
      return bitmap
    }

    val ratio = Math.min(
      MAX_WIDGET_ARTWORK_SIZE.toFloat() / width,
      MAX_WIDGET_ARTWORK_SIZE.toFloat() / height
    )
    val targetWidth = Math.max(1, (width * ratio).toInt())
    val targetHeight = Math.max(1, (height * ratio).toInt())
    val scaled = Bitmap.createScaledBitmap(bitmap, targetWidth, targetHeight, true)
    if (scaled !== bitmap) {
      bitmap.recycle()
    }
    return scaled
  }

  private fun getRoundedCornerBitmap(bitmap: Bitmap, pixels: Float): Bitmap {
    val output = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(output)

    val paint = android.graphics.Paint()
    val rect = android.graphics.Rect(0, 0, bitmap.width, bitmap.height)
    val rectF = android.graphics.RectF(rect)

    paint.isAntiAlias = true
    canvas.drawARGB(0, 0, 0, 0)
    paint.color = -0xbdbdbe
    canvas.drawRoundRect(rectF, pixels, pixels, paint)

    paint.xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC_IN)
    canvas.drawBitmap(bitmap, rect, rect, paint)

    return output
  }
}
