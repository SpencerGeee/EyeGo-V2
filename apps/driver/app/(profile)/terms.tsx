import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { WebView } from 'react-native-webview';
import { spacing, radii } from '@eyego/config';
import { Text, AppBackground } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';

export default function TermsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground variant="static" />
      <MotiView
        from={{ opacity: 0, translateY: -4 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={styles.header}
      >
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
        <Text variant="titleMedium" style={styles.headerTitle} color={colors.onSurface}>
          Driver Agreement
        </Text>
        <View style={styles.backBtn} pointerEvents="none" />
      </MotiView>

      <View style={styles.webviewContainer}>
        <WebView
          source={{ uri: 'https://eyego.app/driver/terms' }}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.base,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  backBtn: { width: 70 },
  headerTitle: { flex: 1, textAlign: 'center' },
  webviewContainer: { flex: 1, position: 'relative' },
  webview: { flex: 1, backgroundColor: colors.backgroundDeep },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundDeep,
  },
});
