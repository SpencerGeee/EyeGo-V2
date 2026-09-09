package expo.modules.eyegodriverwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/**
 * ── THE DRIVER'S HOME-SCREEN WIDGET ─────────────────────────────────────────
 *
 * Deliberately a classic RemoteViews AppWidget rather than Glance.
 *
 * Glance is nicer to author, and it drags the whole Jetpack Compose runtime
 * into the Android build along with a Kotlin/compose-compiler version
 * constraint. This app already links MapLibre, Skia and Reanimated native code;
 * a version clash between any of those and a Compose toolchain does not make
 * the widget look wrong, it makes the app fail to compile. RemoteViews needs
 * nothing beyond androidx and works on every Android version the app supports.
 *
 * ── WHAT THIS CAN AND CANNOT SHOW ───────────────────────────────────────────
 *
 * It shows SLOW FACTS: today's earnings, trips completed, online state, quest
 * progress. It deliberately does NOT show a dispatch offer, and could not: the
 * OS updates widgets on a budget measured in minutes, while a dispatch offer is
 * live for forty-five seconds. Offers reach a backgrounded driver by push
 * (`interruption-level: time-sensitive`), which is the mechanism built for it.
 *
 * ── WHERE THE DATA COMES FROM ───────────────────────────────────────────────
 *
 * SharedPreferences, written by `EyeGoDriverWidgetModule` from JS. The widget
 * process is separate from the app process and may be woken when the app is not
 * running at all, so it can never call into JS — it can only read what the app
 * last left for it. Every value therefore has a defined default, and the widget
 * renders honestly when it has never been told anything.
 */
class DriverWidgetProvider : AppWidgetProvider() {

  companion object {
    const val PREFS = "eyego_driver_widget"
    const val KEY_EARNINGS = "earningsLabel"
    const val KEY_TRIPS = "tripsLabel"
    const val KEY_ONLINE = "online"
    const val KEY_QUEST = "questLabel"
    const val KEY_UPDATED = "updatedAtMs"

    /** Broadcast the app sends to force a redraw after writing new data. */
    const val ACTION_REFRESH = "com.eyego.driver.widget.REFRESH"

    /**
     * The online/offline toggle.
     *
     * A widget cannot run app code, so tapping this cannot flip the switch by
     * itself. It opens the app with an intent the JS side reads and acts on —
     * which is the honest behaviour: going online has server-side
     * preconditions (documents approved, no unfinished trip) that a widget has
     * no way to evaluate, and a toggle that silently failed would be worse than
     * one that takes the driver to the screen that can explain why.
     */
    const val ACTION_TOGGLE = "com.eyego.driver.widget.TOGGLE_ONLINE"

    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, DriverWidgetProvider::class.java))
      if (ids.isEmpty()) return
      for (id in ids) render(context, manager, id)
    }

    private fun render(context: Context, manager: AppWidgetManager, widgetId: Int) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val views = RemoteViews(context.packageName, R.layout.eyego_driver_widget)

      // Defaults matter: the widget can be placed before the app has ever
      // written anything, and an em dash is an honest "not yet" where a 0.00
      // would be a claim about the driver's earnings.
      val hasData = prefs.getLong(KEY_UPDATED, 0L) > 0L
      views.setTextViewText(R.id.widget_earnings, prefs.getString(KEY_EARNINGS, null) ?: "—")
      views.setTextViewText(
        R.id.widget_trips,
        if (hasData) prefs.getString(KEY_TRIPS, "") ?: "" else "Open the app to sync",
      )
      views.setTextViewText(R.id.widget_quest, prefs.getString(KEY_QUEST, null) ?: "")

      val online = prefs.getBoolean(KEY_ONLINE, false)
      views.setTextViewText(R.id.widget_status, if (online) "Online" else "Offline")
      views.setInt(
        R.id.widget_status_dot,
        "setBackgroundResource",
        if (online) R.drawable.widget_dot_online else R.drawable.widget_dot_offline,
      )

      // Whole widget opens the app; the status pill opens it on the toggle
      // intent. Both go through the launcher intent so the app's own routing
      // and auth gate decide where the driver actually lands.
      views.setOnClickPendingIntent(R.id.widget_root, launchIntent(context, null))
      views.setOnClickPendingIntent(R.id.widget_status_pill, launchIntent(context, ACTION_TOGGLE))

      manager.updateAppWidget(widgetId, views)
    }

    private fun launchIntent(context: Context, action: String?): PendingIntent {
      val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: Intent(Intent.ACTION_MAIN)
      intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      if (action != null) intent.putExtra("eyegoWidgetAction", action)
      // FLAG_IMMUTABLE is required from Android 12 (S) and is correct here: the
      // receiver never needs to fill anything in. Omitting it is a crash on 12+.
      return PendingIntent.getActivity(
        context,
        if (action == null) 0 else 1,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }

  override fun onUpdate(context: Context, manager: AppWidgetManager, widgetIds: IntArray) {
    for (id in widgetIds) render(context, manager, id)
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    // The app finished writing new values and asked for a redraw.
    if (intent.action == ACTION_REFRESH) refresh(context)
  }
}
