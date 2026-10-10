package expo.modules.musicwidget

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.KeyEvent

class WidgetActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val actionName = intent.getStringExtra("action")
        if (actionName != null) {
            // Wake up JS if it is alive
            MusicWidgetModule.sendWidgetAction(actionName)

            // Also directly wake up MusicService using MediaButton intents to ensure it runs even if JS is dead
            val keycode = when (actionName) {
                "play_pause" -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
                "prev" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
                else -> -1
            }

            if (keycode != -1) {
                val comp = ComponentName(context, "com.doublesymmetry.trackplayer.service.MusicService")

                val intentDown = Intent(Intent.ACTION_MEDIA_BUTTON)
                intentDown.component = comp
                intentDown.putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, keycode))

                val intentUp = Intent(Intent.ACTION_MEDIA_BUTTON)
                intentUp.component = comp
                intentUp.putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_UP, keycode))

                try {
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                        context.startForegroundService(intentDown)
                        context.startForegroundService(intentUp)
                    } else {
                        context.startService(intentDown)
                        context.startService(intentUp)
                    }
                } catch (e: Exception) {
                    // Ignore foreground service errors if killed
                }
            }
        }
    }
}
