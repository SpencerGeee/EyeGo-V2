import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Tabs } from 'expo-router';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  interpolateColor,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const AnimatedIonicons = Animated.createAnimatedComponent(Ionicons);
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, springs, type ColorTokens } from '@eyego/config';
import { Text, GlassSurface } from '@eyego/ui';
import { useColors } from '../../utils/useColors';
import { useThemeStore } from '../../stores/theme.store';

type TabRoute = 'home' | 'services' | 'activity' | 'account';

/**
 * Visual height of the floating tab bar content (excluding the device bottom
 * inset). Screens under the tab bar should pad their scroll content by
 * TAB_BAR_BASE_HEIGHT + insets.bottom + breathing room.
 */
export const TAB_BAR_BASE_HEIGHT = 72;

const TAB_ICONS: Record<TabRoute, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  home: { active: 'home', inactive: 'home-outline' },
  services: { active: 'grid', inactive: 'grid-outline' },
  activity: { active: 'time', inactive: 'time-outline' },
  account: { active: 'person-circle', inactive: 'person-circle-outline' },
};

const TAB_LABELS: Record<TabRoute, string> = {
  home: 'HOME',
  services: 'SERVICES',
  activity: 'ACTIVITY',
  account: 'PROFILE',
};

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const colors = useColors();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const isDark = useThemeStore((s) => s.isDark);
  return (
    <View style={styles.tabBarWrapper}>
      {/* Maximum-transparency liquid glass — LiquidGlassView on iOS 26+,
          BlurView fallback, tinted View as a last resort. */}
      <GlassSurface
        intensity="high"
        dark={isDark}
        chromaticHint
        style={StyleSheet.absoluteFill}
      />
      {/* top highlight line — native iOS glass feel */}
      <View style={styles.topBorder} />
      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom - 6, 10) }]}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const routeName = route.name as TabRoute;

          const handlePress = () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TabItem
              key={route.key}
              routeName={routeName}
              isFocused={isFocused}
              onPress={handlePress}
            />
          );
        })}
      </View>
    </View>
  );
}

function TabItem({
  routeName,
  isFocused,
  onPress,
}: {
  routeName: TabRoute;
  isFocused: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const styles = getStyles(colors);
  const scale = useSharedValue(1);
  // Animated focus progress (0 = inactive, 1 = active). Driven by springs.tab
  // so the active pill and icon ease in/out instead of snapping — the
  // Telegram/WhatsApp tab-bar feel.
  const focus = useSharedValue(isFocused ? 1 : 0);
  const icons = TAB_ICONS[routeName];

  React.useEffect(() => {
    focus.value = withSpring(isFocused ? 1 : 0, springs.tab);
  }, [isFocused, focus]);

  // Guard: route exists in the directory but is not a visible tab
  if (!icons) return null;

  // Press feedback multiplies onto the focus-driven idle scale.
  const innerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Pill background fades + subtly scales up as the tab gains focus.
  const pillStyle = useAnimatedStyle(() => ({
    opacity: focus.value,
    transform: [{ scale: interpolate(focus.value, [0, 1], [0.8, 1]) }],
  }));

  // Crossfade the filled (active) icon over the outline (inactive) one and
  // give the active glyph a gentle pop so the swap reads as a morph.
  const activeIconStyle = useAnimatedStyle(() => ({
    opacity: focus.value,
    transform: [{ scale: interpolate(focus.value, [0, 1], [0.85, 1]) }],
  }));
  const inactiveIconStyle = useAnimatedStyle(() => ({
    opacity: 1 - focus.value,
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      focus.value,
      [0, 1],
      [colors.onSurfaceVariant, colors.primary]
    ),
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withTiming(0.92, { duration: 100, easing: Easing.out(Easing.quad) });
      }}
      onPressOut={() => { scale.value = withSpring(1, springs.press); }}
      style={styles.tabItem}
      accessibilityRole="button"
      accessibilityLabel={TAB_LABELS[routeName]}
      accessibilityState={{ selected: isFocused }}
    >
      <Animated.View style={[styles.tabItemInner, innerStyle]}>
        <Animated.View style={[styles.tabItemActive, StyleSheet.absoluteFill, pillStyle]} />
        <View style={styles.iconWrap}>
          <AnimatedIonicons
            style={[StyleSheet.absoluteFill, styles.iconLayer, inactiveIconStyle]}
            name={icons.inactive}
            size={22}
            color={colors.onSurfaceVariant}
          />
          <AnimatedIonicons
            style={[StyleSheet.absoluteFill, styles.iconLayer, activeIconStyle]}
            name={icons.active}
            size={22}
            color={colors.primary}
          />
        </View>
        <Animated.Text style={[styles.tabLabel, labelStyle]}>
          {TAB_LABELS[routeName]}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        // Bottom-tabs v7 renamed sceneContainerStyle → sceneStyle; the old
        // prop is silently ignored, which left the default (white, from the
        // navigation theme) scene container between every tab screen and the
        // root AppBackground. Transparent scenes are what let the ambient
        // orb background show through on home/services/activity/account.
        sceneStyle: { backgroundColor: 'transparent' },
        // Cross-fade between tabs instead of a hard cut.
        animation: 'fade',
      }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="services" />
      <Tabs.Screen name="activity" />
      <Tabs.Screen name="account" />
      {/* Legacy screens kept for deep-link routing — hidden from tab bar */}
      <Tabs.Screen name="trips" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  );
}

function getStyles(colors: ColorTokens) {
  return StyleSheet.create({
    tabBarWrapper: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderTopWidth: 1,
      borderTopColor: colors.rimLight,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -8 },
      shadowOpacity: 0.40,
      shadowRadius: 20,
      elevation: 20,
      overflow: 'hidden',
    },
    topBorder: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 1,
      backgroundColor: colors.rimLight,
      zIndex: 1,
    },
    tabBar: {
      flexDirection: 'row',
      minHeight: TAB_BAR_BASE_HEIGHT,
      alignItems: 'center',
      paddingHorizontal: 4,
      paddingTop: 8,
    },
    tabItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
    },
    tabItemInner: {
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      gap: 3,
      minHeight: 52,
      borderRadius: 16,
      overflow: 'hidden',
    },
    tabItemActive: {
      backgroundColor: `${colors.primary}14`,
      borderRadius: 16,
    },
    iconWrap: {
      width: 22,
      height: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconLayer: {
      textAlign: 'center',
    },
    tabLabel: {
      fontFamily: fonts.labelCaps,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 0.6,
    },
  });
}
