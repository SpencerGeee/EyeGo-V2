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
import { fonts, spacing } from '@eyego/config';
import { Text } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';

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

type TabRoute = 'home' | 'trips' | 'earnings' | 'notifications' | 'profile' | 'quests';

const TAB_ICONS: Record<TabRoute, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  home: { active: 'map', inactive: 'map-outline' },
  trips: { active: 'time', inactive: 'time-outline' },
  earnings: { active: 'wallet', inactive: 'wallet-outline' },
  notifications: { active: 'notifications', inactive: 'notifications-outline' },
  profile: { active: 'person', inactive: 'person-outline' },
  quests: { active: 'trophy', inactive: 'trophy-outline' },
};

const TAB_LABELS: Record<TabRoute, string> = {
  home: 'Drive',
  trips: 'Trips',
  earnings: 'Earnings',
  notifications: 'Alerts',
  profile: 'Profile',
  quests: 'Quests',
};

/** Renders the glassmorphism / Liquid Glass background layer */
function GlassLayer({ isDark, colors }: { isDark: boolean; colors: DriverColors }) {
  if (isLiquidGlassSupported && LiquidGlassView) {
    return <LiquidGlassView style={StyleSheet.absoluteFill} colorScheme={isDark ? 'dark' : 'light'} />;
  }
  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={80}
        tint={isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        style={StyleSheet.absoluteFill}
      />
    );
  }
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: isDark ? 'rgba(6, 15, 26, 0.92)' : 'rgba(255, 255, 255, 0.85)' },
      ]}
    />
  );
}

function TabItem({ routeName, isFocused, onPress, colors, styles }: {
  routeName: TabRoute;
  isFocused: boolean;
  onPress: () => void;
  colors: DriverColors;
  styles: ReturnType<typeof makeStyles>;
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
          size={20}
          color={isFocused ? colors.primary : colors.onSurfaceVariant}
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

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const colors = useColors();
  const theme = useDriverStore(s => s.theme);
  const isDark = theme !== 'light';
  const styles = React.useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.tabBarWrapper}>
      <GlassLayer isDark={isDark} colors={colors} />
      <View style={styles.topBorder} />
      <View style={styles.tabBar}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
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
              routeName={route.name as TabRoute}
              isFocused={isFocused}
              onPress={handlePress}
              colors={colors}
              styles={styles}
            />
          );
        })}
      </View>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="home" />
      <Tabs.Screen name="quests" />
      <Tabs.Screen name="trips" />
      <Tabs.Screen name="earnings" />
      <Tabs.Screen name="notifications" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const makeStyles = (colors: DriverColors) => StyleSheet.create({
  tabBarWrapper: {
    position: 'absolute',
    bottom: 24,
    left: spacing['2xl'],
    right: spacing['2xl'],
    borderRadius: 28,
    borderWidth: 1,
    borderColor: `${colors.primary}22`,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.30,
    shadowRadius: 24,
    elevation: 20,
    overflow: 'hidden',
  },
  topBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: `${colors.primary}30`,
    zIndex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    height: 56,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minWidth: 0,
  },
  tabItemInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 3,
    minHeight: 36,
    borderRadius: 16,
    overflow: 'hidden',
  },
  tabItemActive: {
    backgroundColor: `${colors.primary}20`,
  },
  tabLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    lineHeight: 13,
    color: colors.primary,
    flexShrink: 0,
  },
});
