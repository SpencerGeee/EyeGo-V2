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
import { fonts, spacing } from '@eyego/config';
import { Text } from '@eyego/ui';
import { driverColors } from '../../utils/useColors';

type TabRoute = 'home' | 'trips' | 'earnings' | 'notifications' | 'profile';

const TAB_ICONS: Record<TabRoute, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  home: { active: 'map', inactive: 'map-outline' },
  trips: { active: 'time', inactive: 'time-outline' },
  earnings: { active: 'wallet', inactive: 'wallet-outline' },
  notifications: { active: 'notifications', inactive: 'notifications-outline' },
  profile: { active: 'person', inactive: 'person-outline' },
};

const TAB_LABELS: Record<TabRoute, string> = {
  home: 'Drive',
  trips: 'Trips',
  earnings: 'Earnings',
  notifications: 'Alerts',
  profile: 'Profile',
};

function TabItem({ routeName, isFocused, onPress }: {
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
    >
      <Animated.View style={[
        styles.tabItemInner,
        isFocused && {
          backgroundColor: 'rgba(59, 130, 246, 0.14)',
          borderRadius: 16,
        },
        animStyle,
      ]}>
        <Ionicons
          name={isFocused ? icons.active : icons.inactive}
          size={20}
          color={isFocused ? driverColors.primary : driverColors.onSurfaceVariant}
        />
        {isFocused && (
          <Text style={[styles.tabLabel, { color: driverColors.primary }]}>
            {TAB_LABELS[routeName]}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  return (
    <View style={styles.tabBarWrapper}>
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
      <Tabs.Screen name="trips" />
      <Tabs.Screen name="earnings" />
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
    backgroundColor: 'rgba(6, 15, 26, 0.88)',
    borderRadius: 24,
    borderWidth: 1.2,
    borderColor: 'rgba(59, 130, 246, 0.18)',
    shadowColor: driverColors.primary,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 8,
    overflow: 'hidden',
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
    gap: spacing.xs,
    minHeight: 40,
  },
  tabLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
  },
});
