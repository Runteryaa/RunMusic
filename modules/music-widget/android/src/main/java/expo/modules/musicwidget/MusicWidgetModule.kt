package expo.modules.musicwidget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.widget.RemoteViews
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.URL

class MusicWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MusicWidget")

    AsyncFunction("updateWidget") { title: String, artist: String, artworkUri: String?, isPlaying: Boolean, bgColorHex: String? ->
      val context = appContext.reactContext ?: return@AsyncFunction
      val appWidgetManager = AppWidgetManager.getInstance(context)

      val bitmap = try {
        if (artworkUri != null) {
          if (artworkUri.startsWith("http")) {
            BitmapFactory.decodeStream(URL(artworkUri).openStream())
          } else {
            val path = artworkUri.replace("file://", "")
            BitmapFactory.decodeFile(path)
          }
        } else null
      } catch (e: Exception) {
        null
      }

      val bgColor = try { Color.parseColor(bgColorHex ?: "#212121") } catch (e: Exception) { Color.parseColor("#212121") }

      // Update 1x4
      val comp1x4 = ComponentName(context, MusicWidgetProvider1x4::class.java)
      val ids1x4 = appWidgetManager.getAppWidgetIds(comp1x4)
      if (ids1x4.isNotEmpty()) {
        val views = RemoteViews(context.packageName, context.resources.getIdentifier("widget_1x4", "layout", context.packageName))
        updateViews(context, views, title, artist, bitmap, isPlaying, bgColor)
        MusicWidgetProvider1x4.updateAppWidget(context, appWidgetManager, ids1x4[0]) // just ensures intents
        appWidgetManager.updateAppWidget(comp1x4, views)
      }

      // Update 2x4
      val comp2x4 = ComponentName(context, MusicWidgetProvider2x4::class.java)
      val ids2x4 = appWidgetManager.getAppWidgetIds(comp2x4)
      if (ids2x4.isNotEmpty()) {
        val views = RemoteViews(context.packageName, context.resources.getIdentifier("widget_2x4", "layout", context.packageName))
        updateViews(context, views, title, artist, bitmap, isPlaying, bgColor)
        MusicWidgetProvider2x4.updateAppWidget(context, appWidgetManager, ids2x4[0])
        appWidgetManager.updateAppWidget(comp2x4, views)
      }
    }
  }

  private fun updateViews(context: Context, views: RemoteViews, title: String, artist: String, bitmap: Bitmap?, isPlaying: Boolean, bgColor: Int) {
    views.setTextViewText(context.resources.getIdentifier("widget_title", "id", context.packageName), title)
    views.setTextViewText(context.resources.getIdentifier("widget_artist", "id", context.packageName), artist)
    
    val bgShape = context.resources.getIdentifier("widget_container", "id", context.packageName)
    // We can't directly set background color on a shape drawable in RemoteViews easily,
    // so we set the background color of the container layout (which will lose rounded corners unless we use a colored rounded shape, but this is fine for now).
    // Actually, setting int color is better on a solid view or we just set background color of the container.
    // To keep corners, we can't easily tint a drawable from RemoteViews before API 31.
    // Let's just set the background color directly.
    views.setInt(bgShape, "setBackgroundColor", bgColor)

    if (bitmap != null) {
      views.setImageViewBitmap(context.resources.getIdentifier("widget_artwork", "id", context.packageName), bitmap)
    } else {
      views.setImageViewResource(context.resources.getIdentifier("widget_artwork", "id", context.packageName), android.R.color.transparent)
    }

    val playPauseBtn = context.resources.getIdentifier("widget_btn_play_pause", "id", context.packageName)
    if (isPlaying) {
      views.setImageViewResource(playPauseBtn, context.resources.getIdentifier("ic_pause", "drawable", context.packageName))
    } else {
      views.setImageViewResource(playPauseBtn, context.resources.getIdentifier("ic_play", "drawable", context.packageName))
    }
  }
}
