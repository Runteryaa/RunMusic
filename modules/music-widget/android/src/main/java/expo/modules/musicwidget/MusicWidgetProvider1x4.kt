package expo.modules.musicwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.KeyEvent
import android.widget.RemoteViews

class MusicWidgetProvider1x4 : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    companion object {
        fun updateAppWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
            val views = RemoteViews(context.packageName, context.resources.getIdentifier("widget_1x4", "layout", context.packageName))

            // Intents for Media Buttons
            views.setOnClickPendingIntent(
                context.resources.getIdentifier("widget_btn_play_pause", "id", context.packageName),
                getMediaButtonPendingIntent(context, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
            )
            views.setOnClickPendingIntent(
                context.resources.getIdentifier("widget_btn_next", "id", context.packageName),
                getMediaButtonPendingIntent(context, KeyEvent.KEYCODE_MEDIA_NEXT)
            )
            // Note: 1x4 widget only has play/pause and next

            // Intent to open app
            val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            if (launchIntent != null) {
                val pendingIntent = PendingIntent.getActivity(context, 0, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                views.setOnClickPendingIntent(context.resources.getIdentifier("widget_container", "id", context.packageName), pendingIntent)
            }

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }

        private fun getMediaButtonPendingIntent(context: Context, keycode: Int): PendingIntent {
            val intent = Intent(Intent.ACTION_MEDIA_BUTTON)
            intent.setPackage(context.packageName)
            val event = KeyEvent(KeyEvent.ACTION_DOWN, keycode)
            intent.putExtra(Intent.EXTRA_KEY_EVENT, event)
            return PendingIntent.getBroadcast(context, keycode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }
}