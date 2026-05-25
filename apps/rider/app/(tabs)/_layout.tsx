import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, spacing, radii, fonts, fontSizes } from '@eyego/config';
import { Text } from '@eyego/ui';

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

function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  return (
    <View style={styles.tabBarWrapper}>
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

  const handlePressIn = () => {
    scale.value = withSpring(0.88, { stiffness: 600, damping: 15 });
  };
  const handlePressOut = () => {
    scale.value = withSpring(1, { stiffness: 600, damping: 15 });
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={styles.tabItem}
    >
      <Animated.View style={[
        styles.tabItemInner,
        isFocused && { backgroundColor: 'rgba(75, 226, 119, 0.12)', borderRadius: 16 },
        animStyle
      ]}>
        <Ionicons
          name={isFocused ? icons.active : icons.inactive}
          size={20}
          color={isFocused ? colors.primary : colors.onSurfaceVariant}
        />
        {isFocused && (
          <Text
            style={[
              styles.tabLabel,
              { color: colors.primary },
            ]}
          >
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
      screenOptions={{
        headerShown: false,
      }}
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
    backgroundColor: 'rgba(12, 14, 20, 0.78)',
    borderRadius: 24,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.4,
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
