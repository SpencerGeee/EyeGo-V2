import React, { useState, useMemo, useEffect } from 'react';
import { View, StyleSheet, Pressable, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { fonts, spacing, radii } from '@eyego/config';
import { useColors, Colors } from '../../utils/useColors';
import { Text, Button, Input } from '@eyego/ui';

// Simple card type detection
const getCardType = (number: string) => {
  const cleanNumber = number.replace(/\D/g, '');
  if (cleanNumber.startsWith('4')) return 'Visa';
  if (/^5[1-5]/.test(cleanNumber)) return 'Mastercard';
  if (/^3[47]/.test(cleanNumber)) return 'Amex';
  if (/^0(2|5)/.test(cleanNumber)) return 'MOMO'; // Mock MOMO detection
  return 'Unknown';
};

const formatCardNumber = (number: string, type: string) => {
  const cleanNumber = number.replace(/\D/g, '');
  if (type === 'Amex') {
    const match = cleanNumber.match(/^(\d{0,4})(\d{0,6})(\d{0,5})$/);
    if (match) {
      return [match[1], match[2], match[3]].filter(Boolean).join(' ');
    }
  }
  const match = cleanNumber.match(/.{1,4}/g);
  return match ? match.join(' ') : cleanNumber;
};

const formatExpiry = (expiry: string) => {
  const clean = expiry.replace(/\D/g, '');
  if (clean.length >= 2) {
    return `${clean.slice(0, 2)}/${clean.slice(2, 4)}`;
  }
  return clean;
};

export default function AddCardScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [cardType, setCardType] = useState('Unknown');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setCardType(getCardType(cardNumber));
  }, [cardNumber]);

  const handleCardNumberChange = (text: string) => {
    const type = getCardType(text);
    const formatted = formatCardNumber(text, type);
    setCardNumber(formatted);
  };

  const handleExpiryChange = (text: string) => {
    setExpiry(formatExpiry(text));
  };

  const handleCvvChange = (text: string) => {
    setCvv(text.replace(/\D/g, '').slice(0, cardType === 'Amex' ? 4 : 3));
  };

  const handleSave = () => {
    if (cardNumber.replace(/\D/g, '').length < 10) {
      Alert.alert('Invalid Card', 'Please enter a valid card number.');
      return;
    }
    if (expiry.length < 5) {
      Alert.alert('Invalid Expiry', 'Please enter a valid expiry date.');
      return;
    }
    if (cvv.length < 3) {
      Alert.alert('Invalid CVV', 'Please enter a valid CVV.');
      return;
    }
    if (!cardholderName.trim()) {
      Alert.alert('Invalid Name', 'Please enter the cardholder name.');
      return;
    }

    setIsSaving(true);
    // Mock saving token
    setTimeout(() => {
      setIsSaving(false);
      Alert.alert('Success', 'Payment method added successfully.', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    }, 1500);
  };

  const getCardIcon = () => {
    switch (cardType) {
      case 'Visa': return 'card';
      case 'Mastercard': return 'card';
      case 'Amex': return 'card';
      case 'MOMO': return 'phone-portrait';
      default: return 'card-outline';
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={16}>
            <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
          </Pressable>
          <Text variant="titleMedium" style={styles.headerTitle}>Add Payment Method</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Card Preview */}
          <MotiView
            from={{ opacity: 0, scale: 0.94, rotateX: '10deg' }}
            animate={{ opacity: 1, scale: 1, rotateX: '0deg' }}
            transition={{ type: 'spring', stiffness: 580, damping: 34, mass: 0.8 }}
            style={styles.cardContainer}
          >
            <BlurView intensity={40} tint="dark" style={styles.cardGlass}>
              <View style={styles.cardTop}>
                <Ionicons name="hardware-chip" size={36} color="rgba(255,255,255,0.8)" />
                <View style={styles.cardTypeBadge}>
                  <Ionicons name={getCardIcon()} size={16} color="#FFFFFF" />
                  <Text style={styles.cardTypeText}>{cardType !== 'Unknown' ? cardType : 'Card'}</Text>
                </View>
              </View>

              <View style={styles.cardMiddle}>
                <Text style={styles.cardNumberPreview}>
                  {cardNumber || '•••• •••• •••• ••••'}
                </Text>
              </View>

              <View style={styles.cardBottom}>
                <View style={styles.cardMetaItem}>
                  <Text style={styles.metaLabel}>CARDHOLDER</Text>
                  <Text style={styles.metaValue} numberOfLines={1}>
                    {cardholderName.toUpperCase() || 'YOUR NAME'}
                  </Text>
                </View>
                <View style={styles.cardMetaItemRight}>
                  <Text style={styles.metaLabel}>EXPIRES</Text>
                  <Text style={styles.metaValue}>{expiry || 'MM/YY'}</Text>
                </View>
              </View>
            </BlurView>
          </MotiView>

          {/* Form */}
          <MotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'spring', stiffness: 580, damping: 34, mass: 0.8, delay: 100 }}
            style={styles.form}
          >
            <Input
              label="Card Number"
              value={cardNumber}
              onChangeText={handleCardNumberChange}
              keyboardType="numeric"
              maxLength={cardType === 'Amex' ? 17 : 19}
              placeholder="0000 0000 0000 0000"
              leftIcon={<Ionicons name={getCardIcon()} size={20} color="rgba(255,255,255,0.5)" />}
            />

            <View style={styles.row}>
              <View style={styles.flex1}>
                <Input
                  label="Expiry Date"
                  value={expiry}
                  onChangeText={handleExpiryChange}
                  keyboardType="numeric"
                  maxLength={5}
                  placeholder="MM/YY"
                />
              </View>
              <View style={{ width: spacing.md }} />
              <View style={styles.flex1}>
                <Input
                  label="CVV"
                  value={cvv}
                  onChangeText={handleCvvChange}
                  keyboardType="numeric"
                  maxLength={cardType === 'Amex' ? 4 : 3}
                  placeholder="123"
                  secureTextEntry
                />
              </View>
            </View>

            <Input
              label="Cardholder Name"
              value={cardholderName}
              onChangeText={setCardholderName}
              autoCapitalize="characters"
              placeholder="JOHN DOE"
            />
          </MotiView>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label="Save Payment Method"
            onPress={handleSave}
            loading={isSaving}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050508' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
  },
  headerTitle: { color: '#FFFFFF', fontFamily: fonts.bold },
  scroll: {
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing.md,
    paddingBottom: spacing['3xl'],
    gap: spacing.xl,
  },
  cardContainer: {
    borderRadius: radii['2xl'],
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    aspectRatio: 1.586, // Standard credit card ratio
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  cardGlass: { 
    flex: 1,
    padding: spacing.xl,
    justifyContent: 'space-between',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.full,
    gap: 4,
  },
  cardTypeText: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  cardMiddle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardNumberPreview: {
    fontSize: 24,
    fontFamily: fonts.bold,
    color: '#FFFFFF',
    letterSpacing: 2,
    textAlign: 'center',
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardMetaItem: { flex: 1, paddingRight: spacing.md },
  cardMetaItemRight: { alignItems: 'flex-end' },
  metaLabel: {
    fontSize: 9,
    fontFamily: fonts.bold,
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  metaValue: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  form: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
  },
  flex1: {
    flex: 1,
  },
  footer: {
    padding: spacing['2xl'],
    paddingBottom: Platform.OS === 'ios' ? spacing['2xl'] : spacing.xl,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    backgroundColor: '#050508',
  },
});
