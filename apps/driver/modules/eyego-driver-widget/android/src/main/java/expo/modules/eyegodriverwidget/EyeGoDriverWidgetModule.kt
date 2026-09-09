package expo.modules.eyegodriverwidget

import android.content.Context
import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The bridge between the driver app and its home-screen widget.
 *
 * The widget runs in a different process and is woken by the launcher, often
 * when the app is not running at all — so it cannot ask the app for anything.
 * The only workable direction is the app LEAVING data somewhere the widget can
 * read later, which is what SharedPreferences is for.
 *
 * Everything here is therefore write-and-broadcast: store the values, then tell
 * the widget to redraw. If no widget is placed the broadcast is a no-op, which
 * is why `setData` is safe to call unconditionally from JS.
 */
class EyeGoDriverWidgetModule : Module() {

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("EyeGoDriverWidgetModule")

    /**
     * Store what the widget should show, then redraw it.
     *
     * Values are pre-FORMATTED strings rather than numbers on purpose. Money
     * formatting in this product is a solved problem on the JS side
     * (`formatGhs`, pesewas-in / cedis-out) and duplicating it in Kotlin is how
     * the two come to disagree about a currency symbol or a rounding rule. The
     * widget renders exactly what the app told it to render.
     */
    Function("setData") { earningsLabel: String, tripsLabel: String, questLabel: String, online: Boolean ->
      context
        .getSharedPreferences(DriverWidgetProvider.PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(DriverWidgetProvider.KEY_EARNINGS, earningsLabel)
        .putString(DriverWidgetProvider.KEY_TRIPS, tripsLabel)
        .putString(DriverWidgetProvider.KEY_QUEST, questLabel)
        .putBoolean(DriverWidgetProvider.KEY_ONLINE, online)
        .putLong(DriverWidgetProvider.KEY_UPDATED, System.currentTimeMillis())
        .apply()

      DriverWidgetProvider.refresh(context)
    }

    /**
     * Clear the widget on sign-out.
     *
     * A widget still showing yesterday's earnings for a driver who has signed
     * out is both a small privacy leak — the phone may be shared — and a lie
     * about a session that has ended.
     */
    Function("clear") {
      context
        .getSharedPreferences(DriverWidgetProvider.PREFS, Context.MODE_PRIVATE)
        .edit()
        .clear()
        .apply()

      DriverWidgetProvider.refresh(context)
    }

    /** True when at least one widget is actually on a home screen. */
    Function("isPlaced") {
      val manager = android.appwidget.AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(
        android.content.ComponentName(context, DriverWidgetProvider::class.java),
      )
      ids.isNotEmpty()
    }

    /**
     * Ask the launcher to pin a widget (Android 8+ launchers that support it).
     *
     * Returns false when the launcher refuses or is too old, so the JS side can
     * tell the driver to add it by hand rather than leaving a button that
     * appears to do nothing.
     */
    Function("requestPin") {
      val manager = android.appwidget.AppWidgetManager.getInstance(context)
      if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.O) return@Function false
      if (!manager.isRequestPinAppWidgetSupported) return@Function false
      manager.requestPinAppWidget(
        android.content.ComponentName(context, DriverWidgetProvider::class.java),
        null,
        null,
      )
      true
    }
  }
}

/** Kept for symmetry with the provider's action constants. */
internal fun refreshBroadcast(context: Context) {
  context.sendBroadcast(Intent(DriverWidgetProvider.ACTION_REFRESH).setPackage(context.packageName))
}
