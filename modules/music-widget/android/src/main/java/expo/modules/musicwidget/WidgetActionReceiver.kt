package expo.modules.musicwidget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class WidgetActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val actionName = intent.getStringExtra("action")
        if (actionName != null) {
            MusicWidgetModule.sendWidgetAction(actionName)
        }
    }
}
