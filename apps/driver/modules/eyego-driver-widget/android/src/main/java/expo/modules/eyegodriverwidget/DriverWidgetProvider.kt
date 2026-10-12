package expo.modules.eyegodriverwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
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
      views.setOnClickPendingIntent(R.id.widget_root, launchIntent(context))
      views.setOnClickPendingIntent(R.id.widget_status_pill, toggleIntent(context, online))

      manager.updateAppWidget(widgetId, views)
    }

    /**
     * The pill is a promise ("tap to go online") the app never kept: it sent an
     * extra nothing read, so it only opened the app. It now opens a deep link
     * the home screen acts on, naming the state to GO TO rather than "toggle",
     * so an app whose own state has not loaded yet cannot flip the wrong way.
     * A widget cannot run app code — going online has server-side gates a
     * widget cannot evaluate — so it opens the screen that can, and explain.
     */
    private fun toggleIntent(context: Context, online: Boolean): PendingIntent {
      val uri = Uri.parse("eyego-driver://home?go=" + if (online) "offline" else "online")
      val intent = Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      return PendingIntent.getActivity(
        context,
        1,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    private fun launchIntent(context: Context): PendingIntent {
      val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: Intent(Intent.ACTION_MAIN)
      intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
      // FLAG_IMMUTABLE is required from Android 12 (S) and is correct here: the
      // receiver never needs to fill anything in. Omitting it is a crash on 12+.
      return PendingIntent.getActivity(
        context,
        0,
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
