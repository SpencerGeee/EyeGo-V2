import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Tabs } from 'expo-router';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts, type ColorTokens } from '@eyego/config';
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
  const icons = TAB_ICONS[routeName];
  // Guard: route exists in the directory but is not a visible tab
  if (!icons) return null;

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => { scale.value = withSpring(0.88, { stiffness: 600, damping: 15 }); }}
      onPressOut={() => { scale.value = withSpring(1, { stiffness: 600, damping: 15 }); }}
      style={styles.tabItem}
      accessibilityRole="button"
      accessibilityLabel={TAB_LABELS[routeName]}
      accessibilityState={{ selected: isFocused }}
    >
      <Animated.View style={[
        styles.tabItemInner,
        isFocused && styles.tabItemActive,
        animStyle,
      ]}>
        <Ionicons
          name={isFocused ? icons.active : icons.inactive}
          size={22}
          color={isFocused ? colors.primary : colors.onSurfaceVariant}
        />
        <Text style={[styles.tabLabel, { color: isFocused ? colors.primary : colors.onSurfaceVariant }]}>
          {TAB_LABELS[routeName]}
        </Text>
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
        // React Navigation's bottom-tabs gives each scene an opaque white
        // container by default. home.tsx/activity.tsx mask it with their own
        // opaque colors.backgroundDeep fill, which is why only services.tsx
        // (which relies on transparency to show the root AppBackground)
        // showed a white page — the scene wrapper sat between it and
        // AppBackground. Without this, no screen in this tab group can ever
        // show the ambient background through a transparent container.
        sceneContainerStyle: { backgroundColor: 'transparent' },
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
    },
    tabItemActive: {
      backgroundColor: `${colors.primary}14`,
    },
    tabLabel: {
      fontFamily: fonts.labelCaps,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 0.6,
    },
  });
}
