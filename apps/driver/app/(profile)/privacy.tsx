import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { WebView } from 'react-native-webview';
import { spacing, radii } from '@eyego/config';
import { Text, AppBackground } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';

export default function PrivacyScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground variant="static" />
      <MotiView
        from={{ opacity: 0, translateX: -6 }}
        animate={{ opacity: 1, translateX: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.backRow}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
      </MotiView>

      <MotiView
        from={{ opacity: 0, translateY: -6 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}
        style={styles.titleRow}
      >
        <Text variant="headlineLarge" style={styles.headline}>Privacy Policy</Text>
      </MotiView>

      <View style={styles.webviewContainer}>
        <WebView
          source={{ uri: 'https://eyego.app/privacy' }}
          style={styles.webview}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
        />
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: DriverColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  backRow: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.base },
  titleRow: { paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl },
  headline: { letterSpacing: -1, marginBottom: spacing.md },
  webviewContainer: { flex: 1, position: 'relative' },
  webview: { flex: 1, backgroundColor: colors.backgroundDeep },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundDeep,
  },
});
