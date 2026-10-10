package expo.modules.musicwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.view.KeyEvent
import android.widget.RemoteViews

class MusicWidgetProvider2x4 : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    companion object {
        fun updateAppWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
            val views = RemoteViews(context.packageName, context.resources.getIdentifier("widget_2x4", "layout", context.packageName))

            // Intents for Media Buttons
            views.setOnClickPendingIntent(
                context.resources.getIdentifier("widget_btn_play_pause", "id", context.packageName),
                getCustomActionPendingIntent(context, "play_pause")
            )
            views.setOnClickPendingIntent(
                context.resources.getIdentifier("widget_btn_next", "id", context.packageName),
                getCustomActionPendingIntent(context, "next")
            )
            views.setOnClickPendingIntent(
                context.resources.getIdentifier("widget_btn_prev", "id", context.packageName),
                getCustomActionPendingIntent(context, "prev")
            )

            // Intent to open app
            val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            if (launchIntent != null) {
                val pendingIntent = PendingIntent.getActivity(context, 0, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                views.setOnClickPendingIntent(context.resources.getIdentifier("widget_container", "id", context.packageName), pendingIntent)
            }

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }

        private fun getCustomActionPendingIntent(context: Context, actionName: String): PendingIntent {
            val intent = Intent(context, WidgetActionReceiver::class.java)
            intent.putExtra("action", actionName)
            val reqCode = actionName.hashCode()
            return PendingIntent.getBroadcast(context, reqCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }
}