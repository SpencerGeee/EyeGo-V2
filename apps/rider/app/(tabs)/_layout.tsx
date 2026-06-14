import React from 'react';
import { View, StyleSheet, Pressable, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, fonts } from '@eyego/config';
import { Text } from '@eyego/ui';

// Liquid Glass — only available on iOS 26+; fails silently if not installed
let LiquidGlassView: React.ComponentType<any> | null = null;
let isLiquidGlassSupported = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const lg = require('@callstack/liquid-glass');
  LiquidGlassView = lg.LiquidGlassView ?? null;
  isLiquidGlassSupported = lg.isLiquidGlassSupported ?? false;
} catch {
  // package not yet installed or platform unsupported — use expo-blur fallback
}

type TabRoute = 'home' | 'trips' | 'notifications' | 'profile';

const TAB_ICONS: Record<TabRoute, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  home: { active: 'map', inactive: 'map-outline' },
  trips: { active: 'time', inactive: 'time-outline' },
  notifications: { active: 'notifications', inactive: 'notifications-outline' },
  profile: { active: 'person', inactive: 'person-outline' },
};

const TAB_LABELS: Record<TabRoute, string> = {
  home: 'Explore',
  trips: 'Trips',
  notifications: 'Alerts',
  profile: 'Profile',
};

/** Renders the glassmorphism / Liquid Glass background layer */
function GlassLayer() {
  if (isLiquidGlassSupported && LiquidGlassView) {
    return <LiquidGlassView style={StyleSheet.absoluteFill} />;
  }
  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={72}
        tint="systemChromeMaterialDark"
        style={StyleSheet.absoluteFill}
      />
    );
  }
  // Android: elevated dark surface — BlurView has limited Android support
  return <View style={[StyleSheet.absoluteFill, styles.androidFallback]} />;
}

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  return (
    <View style={styles.tabBarWrapper}>
      <GlassLayer />
      {/* top highlight line — native iOS glass feel */}
      <View style={styles.topBorder} />
      <View style={styles.tabBar}>
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
  const scale = useSharedValue(1);
  const icons = TAB_ICONS[routeName];

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
          color={isFocused ? colors.primary : 'rgba(255,255,255,0.45)'}
        />
        {isFocused && (
          <Text style={styles.tabLabel}>
            {TAB_LABELS[routeName]}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="trips" />
      <Tabs.Screen name="notifications" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarWrapper: {
    position: 'absolute',
    bottom: 24,
    left: spacing['2xl'],
    right: spacing['2xl'],
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 20,
    overflow: 'hidden',
    // No backgroundColor — GlassLayer fills it
  },
  androidFallback: {
    backgroundColor: 'rgba(10, 12, 18, 0.90)',
  },
  topBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    zIndex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    height: 64,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  tabItemInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    gap: 5,
    minHeight: 40,
    borderRadius: 16,
  },
  tabItemActive: {
    backgroundColor: `${colors.primary}1A`,
  },
  tabLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: colors.primary,
  },
});
