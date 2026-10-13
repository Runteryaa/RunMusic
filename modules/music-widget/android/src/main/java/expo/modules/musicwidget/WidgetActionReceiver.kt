package expo.modules.musicwidget

import android.app.ActivityOptions
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.view.KeyEvent

class WidgetActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val actionName = intent.getStringExtra("action") ?: return

        // 1. JS zaten aktifse doğrudan React Native event'i ilet
        if (MusicWidgetModule.instance != null) {
            MusicWidgetModule.sendWidgetAction(actionName)
            return
        }

        // 2. Uygulama kapalıysa: Önce TrackPlayer MusicService'e MediaButton intent göndermeyi dene
        val keycode = when (actionName) {
            "play_pause" -> KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
            "prev" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            else -> -1
        }

        if (keycode != -1) {
            try {
                val comp = ComponentName(context, "com.doublesymmetry.trackplayer.service.MusicService")

                val intentDown = Intent(Intent.ACTION_MEDIA_BUTTON).apply {
                    component = comp
                    putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, keycode))
                }

                val intentUp = Intent(Intent.ACTION_MEDIA_BUTTON).apply {
                    component = comp
                    putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_UP, keycode))
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intentDown)
                    context.startForegroundService(intentUp)
                } else {
                    context.startService(intentDown)
                    context.startService(intentUp)
                }
            } catch (e: Exception) {
                // Android 12+ arka plan kısıtlaması nedeniyle yutulabilir
            }
        }

        // 3. Uygulama tamamen kapalıysa arayüzü arka planda uyandırıp parçayı başlat
        try {
            val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                data = Uri.parse("runmusic://widget?action=$actionName&autoPlay=true&background=true")
                putExtra("widget_action", actionName)
                putExtra("auto_play", true)
                putExtra("open_background", true)
            }

            if (launchIntent != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    try {
                        val options = ActivityOptions.makeBasic().apply {
                            setPendingIntentBackgroundActivityStartMode(
                                ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
                            )
                        }.toBundle()
                        context.startActivity(launchIntent, options)
                    } catch (t: Throwable) {
                        context.startActivity(launchIntent)
                    }
                } else {
                    context.startActivity(launchIntent)
                }
            }
        } catch (e: Exception) {
            // Ignore launch errors
        }
    }
}
