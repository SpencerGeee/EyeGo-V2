import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { fonts, spacing, radii, withOpacity } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button, Input } from '@eyego/ui';
import { Toggle } from '@eyego/ui/src/Toggle';

export default function BusinessProfileScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const [isBusinessMode, setIsBusinessMode] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [expMail, setExpMail] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = () => {
    if (isBusinessMode) {
      if (!companyName.trim()) {
        Alert.alert('Missing Info', 'Please enter your company name.');
        return;
      }
      if (!expMail.trim() || !expMail.includes('@')) {
        Alert.alert('Invalid Email', 'Please enter a valid expense email.');
        return;
      }
    }

    // No backend endpoint for business preferences exists yet. Be honest rather
    // than showing a fake "saved" confirmation that persists nothing.
    Alert.alert(
      'Coming Soon',
      'Business profiles aren\'t available yet. We\'ll let you know when expense profiles and ride reporting go live.',
      [{ text: 'OK' }]
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
          </Pressable>
          <Text variant="titleMedium" style={styles.headerTitle}>Business Profile</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Toggle Section */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 580, damping: 34, mass: 0.8 }}
            style={styles.toggleContainer}
          >
            <View style={styles.toggleGlass}>
              <View style={styles.toggleInfo}>
                <View style={styles.iconContainer}>
                  <Ionicons name="briefcase" size={24} color={isBusinessMode ? colors.primary : colors.onSurface} />
                </View>
                <View style={styles.toggleTextContainer}>
                  <Text style={styles.toggleTitle}>Business Expensing</Text>
                  <Text style={styles.toggleDesc}>
                    Automatically send receipts to your company
                  </Text>
                </View>
              </View>
              <Toggle 
                value={isBusinessMode} 
                onValueChange={setIsBusinessMode} 
                tint="eco" 
              />
            </View>
          </MotiView>

          {/* Form Section */}
          {isBusinessMode && (
            <MotiView
              from={{ opacity: 0, height: 0, translateY: -20 }}
              animate={{ opacity: 1, height: 'auto', translateY: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              style={styles.formContainer}
            >
              <Text variant="titleSmall" style={styles.sectionTitle}>Corporate Details</Text>
              
              <View style={styles.form}>
                <Input
                  label="Company Name"
                  value={companyName}
                  onChangeText={setCompanyName}
                  placeholder="Acme Corp"
                  leftIcon={                  <Ionicons name="business-outline" size={20} color={colors.onSurfaceVariant} />}
                />

                <Input
                  label="Tax ID (Optional)"
                  value={taxId}
                  onChangeText={setTaxId}
                  placeholder="XX-XXXXXXX"
                  leftIcon={                  <Ionicons name="document-text-outline" size={20} color={colors.onSurfaceVariant} />}
                />

                <Input
                  label="Expense Email"
                  value={expMail}
                  onChangeText={setExpMail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholder="receipts@acmecorp.com"
                  leftIcon={                  <Ionicons name="mail-outline" size={20} color={colors.onSurfaceVariant} />}
                />
              </View>

              <View style={styles.infoBox}>
                <Ionicons name="information-circle" size={20} color={colors.primary} />
                <Text style={styles.infoText}>
                  When business mode is active, all ride receipts will be automatically forwarded to your expense email.
                </Text>
              </View>
            </MotiView>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label="Save Preferences"
            onPress={handleSave}
            loading={isSaving}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
  },
  headerTitle: { color: colors.onSurface, fontFamily: fonts.bold },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.rimLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.md,
    paddingBottom: spacing['3xl'],
    gap: spacing.xl,
  },
  toggleContainer: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.rimLight,
  },
  toggleGlass: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  toggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: spacing.md,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  toggleTextContainer: {
    flex: 1,
  },
  toggleTitle: {
    color: colors.onSurface,
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 21,
    marginBottom: 4,
  },
  toggleDesc: {
    color: colors.onSurfaceVariant,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  formContainer: {
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.onSurface,
    fontFamily: fonts.bold,
    marginBottom: spacing.xs,
  },
  form: {
    gap: spacing.md,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: withOpacity(colors.primary, 0.1),
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: withOpacity(colors.primary, 0.2),
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  infoText: {
    flex: 1,
    color: colors.onSurfaceVariant,
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 20,
  },
  footer: {
    padding: spacing['2xl'],
    paddingBottom: Platform.OS === 'ios' ? spacing['2xl'] : spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.rimLight,
    backgroundColor: colors.backgroundDeep,
  },
});
