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
import { fonts, type ColorTokens } from '@eyego/config';
import { Text } from '@eyego/ui';
import { useColors } from '../../utils/useColors';

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

type TabRoute = 'home' | 'services' | 'activity' | 'account';

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
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10, 12, 18, 0.92)' }]} />;
}

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const colors = useColors();
  const styles = getStyles(colors);
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
      screenOptions={{ headerShown: false }}
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
      height: 72,
      alignItems: 'center',
      paddingHorizontal: 4,
      paddingTop: 8,
      paddingBottom: 10,
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
      backgroundColor: `${colors.primary}1A`,
    },
    tabLabel: {
      fontFamily: fonts.semiBold,
      fontSize: 9,
      letterSpacing: 0.7,
    },
  });
}
