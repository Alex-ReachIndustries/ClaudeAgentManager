package com.claudemanager.app.widget

import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver

/**
 * Broadcast receiver for the Agent Status widget.
 * Required by the Android widget framework to instantiate the [AgentWidget].
 *
 * Also triggers initial data load when the widget is first placed.
 */
class AgentWidgetReceiver : GlanceAppWidgetReceiver() {

    override val glanceAppWidget: GlanceAppWidget = AgentWidget()
}
