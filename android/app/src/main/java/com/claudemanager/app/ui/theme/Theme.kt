package com.claudemanager.app.ui.theme

import android.app.Activity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * Lumi dark color scheme for Material 3.
 * This is a dark-only theme — the app does not support a light variant.
 */
private val LumiDarkColorScheme = darkColorScheme(
    primary = LumiPurple500,
    onPrimary = LumiOnSurface,
    primaryContainer = LumiPurple700,
    onPrimaryContainer = LumiPurple300,

    secondary = LumiPurple400,
    onSecondary = LumiOnSurface,
    secondaryContainer = LumiPurple700,
    onSecondaryContainer = LumiPurple300,

    tertiary = LumiPurple300,
    onTertiary = LumiBackground,
    tertiaryContainer = LumiPurple600,
    onTertiaryContainer = LumiPurple300,

    background = LumiBackground,
    onBackground = LumiOnSurface,

    surface = LumiSurface,
    onSurface = LumiOnSurface,
    surfaceVariant = LumiCard,
    onSurfaceVariant = LumiOnSurfaceSecondary,

    error = LumiError,
    onError = LumiOnSurface,
    errorContainer = Color(0xFF5C1A1A),
    onErrorContainer = LumiError,

    outline = LumiOnSurfaceTertiary,
    outlineVariant = Color(0xFF2A2A36),

    inverseSurface = LumiOnSurface,
    inverseOnSurface = LumiBackground,
    inversePrimary = LumiPurple600,

    surfaceTint = LumiPurple500,
    scrim = Color(0xFF000000)
)

/**
 * ClaudeManager Lumi theme. Dark-only, with purple accents.
 * Sets the system status bar to the background color for a seamless look.
 */
@Composable
fun ClaudeManagerTheme(content: @Composable () -> Unit) {
    val colorScheme = LumiDarkColorScheme
    val view = LocalView.current

    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = LumiBackground.toArgb()
            window.navigationBarColor = LumiBackground.toArgb()
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = false
                isAppearanceLightNavigationBars = false
            }
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = LumiTypography,
        content = content
    )
}

// Color is imported at the top from androidx.compose.ui.graphics.Color
