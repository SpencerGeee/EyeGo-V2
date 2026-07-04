import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TextInput, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView, AnimatePresence } from 'moti';
import { Ionicons } from '@expo/vector-icons';
import { useRideStore } from '../../stores/ride.store';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button, Radio, AppBackground } from '@eyego/ui';

export default function GuestSelectionScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { guestInfo, setGuestInfo } = useRideStore();

  const [selection, setSelection] = useState<'myself' | 'guest'>(guestInfo ? 'guest' : 'myself');
  const [name, setName] = useState(guestInfo?.name ?? '');
  const [phone, setPhone] = useState(guestInfo?.phone ?? '');
  const [nameError, setNameError] = useState('');
  const [phoneError, setPhoneError] = useState('');

  // RH5: Validate Ghana phone numbers (MTN, Vodafone, AirtelTigo prefixes)
  const PHONE_RE = /^(\+233|0)?[25679]\d{8}$/;

  const handleContinue = useCallback(() => {
    if (selection === 'guest') {
      let valid = true;
      if (!name.trim()) {
        setNameError('Please enter the guest\'s name.');
        valid = false;
      } else {
        setNameError('');
      }
      if (!PHONE_RE.test(phone.trim())) {
        setPhoneError('Enter a valid Ghana phone number (e.g. 024 123 4567).');
        valid = false;
      } else {
        setPhoneError('');
      }
      if (!valid) return;
      setGuestInfo({ name: name.trim(), phone });
    } else {
      setGuestInfo(null);
    }
    router.back();
  }, [selection, name, phone, setGuestInfo, router]);

  const isContinueDisabled = false; // Validation now happens inside handleContinue

  return (
    <SafeAreaView style={styles.safe}>
      <AppBackground variant="static" />
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text variant="titleMedium">Who is riding?</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 50 }}
        >
          <Text variant="bodyLarge" color={colors.onSurfaceVariant} style={styles.subtitle}>
            Choose who this ride is for. You can book a ride for yourself or someone else.
          </Text>

          <View style={styles.optionsContainer}>
            <Pressable
              style={[
                styles.optionCard,
                selection === 'myself' && styles.optionCardSelected,
              ]}
              onPress={() => setSelection('myself')}
            >
              <View style={styles.optionIconContainer}>
                <Ionicons
                  name="person"
                  size={24}
                  color={selection === 'myself' ? colors.primary : colors.onSurfaceVariant}
                />
              </View>
              <View style={styles.optionTextContainer}>
                <Text variant="titleSmall" color={selection === 'myself' ? colors.primary : colors.onSurface}>
                  Myself
                </Text>
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  The ride is for me
                </Text>
              </View>
              <Radio selected={selection === 'myself'} onPress={() => setSelection('myself')} />
            </Pressable>

            <Pressable
              style={[
                styles.optionCard,
                selection === 'guest' && styles.optionCardSelected,
              ]}
              onPress={() => setSelection('guest')}
            >
              <View style={styles.optionIconContainer}>
                <Ionicons
                  name="people"
                  size={24}
                  color={selection === 'guest' ? colors.primary : colors.onSurfaceVariant}
                />
              </View>
              <View style={styles.optionTextContainer}>
                <Text variant="titleSmall" color={selection === 'guest' ? colors.primary : colors.onSurface}>
                  Someone Else
                </Text>
                <Text variant="caption" color={colors.onSurfaceVariant}>
                  Book a ride for a guest
                </Text>
              </View>
              <Radio selected={selection === 'guest'} onPress={() => setSelection('guest')} />
            </Pressable>
          </View>
        </MotiView>

        <AnimatePresence>
          {selection === 'guest' && (
            <MotiView
              from={{ opacity: 0, height: 0, translateY: -10 }}
              animate={{ opacity: 1, height: 200, translateY: 0 }}
              exit={{ opacity: 0, height: 0, translateY: -10 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              style={styles.formContainer}
            >
              <Text variant="titleSmall" style={styles.formTitle}>Guest Details</Text>
              
              <View style={styles.inputGroup}>
                <Text variant="labelMedium" color={colors.onSurfaceVariant} style={styles.label}>
                  Guest Name
                </Text>
                <View style={[styles.inputContainer, !!nameError && { borderColor: '#EF4444' }]}>
                  <Ionicons name="person-outline" size={20} color={colors.onSurfaceVariant} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={(t) => { setName(t); if (nameError) setNameError(''); }}
                    placeholder="Enter guest's full name"
                    placeholderTextColor={colors.onSurfaceVariant}
                  />
                </View>
                {!!nameError && <Text variant="caption" color="#EF4444" style={{ marginTop: 4, marginLeft: 4 }}>{nameError}</Text>}
              </View>

              <View style={styles.inputGroup}>
                <Text variant="labelMedium" color={colors.onSurfaceVariant} style={styles.label}>
                  Phone Number
                </Text>
                <View style={[styles.inputContainer, !!phoneError && { borderColor: '#EF4444' }]}>
                  <Ionicons name="call-outline" size={20} color={colors.onSurfaceVariant} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={phone}
                    onChangeText={(t) => { setPhone(t); if (phoneError) setPhoneError(''); }}
                    placeholder="Enter guest's phone number"
                    placeholderTextColor={colors.onSurfaceVariant}
                    keyboardType="phone-pad"
                  />
                </View>
                {!!phoneError && <Text variant="caption" color="#EF4444" style={{ marginTop: 4, marginLeft: 4 }}>{phoneError}</Text>}
              </View>
            </MotiView>
          )}
        </AnimatePresence>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          variant="glow"
          label="Continue"
          onPress={handleContinue}
          disabled={isContinueDisabled}
        />
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.base,
  },
  scroll: {
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing['3xl'],
    paddingTop: spacing.md,
  },
  subtitle: {
    marginBottom: spacing.xl,
    lineHeight: 24,
  },
  optionsContainer: {
    gap: spacing.md,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
  },
  optionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  optionIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  optionTextContainer: {
    flex: 1,
  },
  formContainer: {
    marginTop: spacing.xl,
    overflow: 'hidden',
  },
  formTitle: {
    marginBottom: spacing.md,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  label: {
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    paddingHorizontal: spacing.md,
    height: 56,
  },
  inputIcon: {
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: fontSizes.bodyLarge,
    lineHeight: Math.round(fontSizes.bodyLarge * 1.3),
    color: colors.onSurface,
  },
  footer: {
    padding: spacing['2xl'],
    paddingTop: spacing.md,
    backgroundColor: colors.backgroundDeep,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
  },
});
