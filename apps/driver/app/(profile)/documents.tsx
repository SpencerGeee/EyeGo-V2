import React, { useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MotiView } from 'moti';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { driverApi } from '@eyego/api';
import type { DriverDocument } from '@eyego/api';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { Text } from '@eyego/ui';
import { Ionicons } from '@expo/vector-icons';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';

const DOCUMENT_CONFIG: {
  type: DriverDocument['type'];
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { type: 'DRIVERS_LICENSE', label: "Driver's License",  description: 'Valid national driver\'s license',           icon: 'card-outline' },
  { type: 'GHANA_CARD',      label: 'National ID / Ghana Card', description: 'Valid Ghana Card or national ID',     icon: 'id-card-outline' },
  { type: 'PROFILE_PHOTO',   label: 'Profile Photo',     description: 'Clear photo of your face for passenger ID', icon: 'person-circle-outline' },
];

const STATUS_CONFIG: Record<DriverDocument['status'], { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  VERIFIED:  { label: 'Verified',  color: '#22C55E', icon: 'checkmark-circle' },
  PENDING:   { label: 'Pending',   color: '#F59E0B', icon: 'time' },
  REJECTED:  { label: 'Rejected',  color: '#F87171', icon: 'close-circle' },
  EXPIRED:   { label: 'Expired',   color: '#F87171', icon: 'warning' },
  MISSING:   { label: 'Missing',   color: '#94A3B8', icon: 'cloud-upload-outline' },
};

function DocumentRow({
  config,
  doc,
  onUpload,
  uploading,
  colors,
}: {
  config: typeof DOCUMENT_CONFIG[number];
  doc?: DriverDocument;
  onUpload: (type: DriverDocument['type']) => void;
  uploading: boolean;
  colors: DriverColors;
}) {
  const status = doc?.status ?? 'MISSING';
  const cfg = STATUS_CONFIG[status];

  return (
    <View style={[styles(colors).docRow]}>
      <View style={[styles(colors).docIconBg, { backgroundColor: `${colors.primary}14` }]}>
        <Ionicons name={config.icon} size={22} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles(colors).docLabel}>{config.label}</Text>
        <Text variant="caption" color={colors.onSurfaceVariant}>{config.description}</Text>
        {doc?.expiresAt && (
          <Text variant="caption" color={status === 'EXPIRED' ? colors.error : colors.onSurfaceVariant}>
            {status === 'EXPIRED' ? 'Expired' : 'Expires'}: {new Date(doc.expiresAt).toLocaleDateString()}
          </Text>
        )}
        {doc?.rejectionReason && status === 'REJECTED' && (
          <Text variant="caption" color={colors.error}>{doc.rejectionReason}</Text>
        )}
      </View>
      <View style={{ alignItems: 'flex-end', gap: spacing.sm }}>
        <View style={[styles(colors).statusBadge, { backgroundColor: `${cfg.color}20`, borderColor: `${cfg.color}55` }]}>
          <Ionicons name={cfg.icon} size={12} color={cfg.color} />
          <Text style={[styles(colors).statusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        {(status === 'MISSING' || status === 'REJECTED' || status === 'EXPIRED') && (
          <Pressable
            style={[styles(colors).uploadBtn, { opacity: uploading ? 0.5 : 1 }]}
            onPress={() => onUpload(config.type)}
            disabled={uploading}
          >
            <Ionicons name="cloud-upload-outline" size={13} color={colors.primary} />
            <Text style={styles(colors).uploadText}>Upload</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function DocumentsScreen() {
  const colors = useColors();
  const router = useRouter();
  const qc = useQueryClient();
  const updateDriver = useDriverStore((s) => s.updateDriver);
  const [uploadingType, setUploadingType] = useState<string | null>(null);

  const { data: documents, isLoading } = useQuery({
    queryKey: ['driver', 'documents'],
    queryFn: () => driverApi.getDocuments(),
    select: (r) => r.data.data ?? [],
  });

  const upload = useMutation({
    mutationFn: async ({ type, uri }: { type: DriverDocument['type']; uri: string }) => {
      const filename = uri.split('/').pop() ?? 'document.jpg';
      const formData = new FormData();
      formData.append('type', type);
      formData.append('file', { uri, name: filename, type: 'image/jpeg' } as any);
      return driverApi.uploadDocument(type, formData);
    },
    onSuccess: (response, { type }) => {
      qc.invalidateQueries({ queryKey: ['driver', 'documents'] });
      if (type === 'PROFILE_PHOTO') {
        const url: string | undefined =
          response?.data?.data?.profilePhotoUrl ??
          response?.data?.data?.documentUrl ??
          response?.data?.data?.url;
        if (url) {
          updateDriver({ profilePhoto: url, avatarUrl: url });
        }
      }
      Alert.alert('Uploaded', 'Your document has been submitted for review. Verification usually takes 1–2 business days.');
    },
    onError: (err) => Alert.alert('Upload Failed', (err as Error).message),
    onSettled: () => setUploadingType(null),
  });

  const handleUpload = async (type: DriverDocument['type']) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photo library to upload documents.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: true,
    });
    if (result.canceled || !result.assets[0]) return;
    setUploadingType(type);
    upload.mutate({ type, uri: result.assets[0].uri });
  };

  const getDoc = (type: DriverDocument['type']) =>
    documents?.find((d) => d.type === type);

  const verifiedCount = documents?.filter((d) => d.status === 'VERIFIED').length ?? 0;
  const totalDocs = DOCUMENT_CONFIG.length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.backgroundDeep }}>
      <MotiView
        from={{ opacity: 0, translateX: -6 }}
        animate={{ opacity: 1, translateX: 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        style={{ paddingHorizontal: spacing['2xl'], paddingTop: spacing.base }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>← Back</Text>
        </Pressable>
      </MotiView>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing['2xl'], paddingTop: spacing.xl, paddingBottom: spacing['3xl'], gap: spacing.xl }} showsVerticalScrollIndicator={false}>
        <MotiView from={{ opacity: 0, translateY: -6 }} animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 34, delay: 40 }}>
          <Text variant="headlineLarge" style={{ letterSpacing: -1, marginBottom: spacing.xs }}>Documents</Text>
          <Text variant="bodyMedium" color={colors.onSurfaceVariant}>
            {verifiedCount}/{totalDocs} documents verified
          </Text>
        </MotiView>

        {/* Progress bar */}
        <MotiView from={{ opacity: 0, translateY: 8 }} animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 80 }}
          style={{ backgroundColor: colors.surfaceContainerHighest, borderRadius: 6, height: 10, overflow: 'hidden' }}>
          <MotiView
            from={{ width: '0%' }}
            animate={{ width: `${(verifiedCount / totalDocs) * 100}%` }}
            transition={{ type: 'timing', duration: 1000, delay: 300 }}
            style={{ height: '100%', backgroundColor: '#22C55E', borderRadius: 6 }}
          />
        </MotiView>

        {/* Documents list */}
        <MotiView from={{ opacity: 0, translateY: 12 }} animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 120 }}
          style={{ backgroundColor: colors.surfaceContainer, borderRadius: radii['2xl'], borderWidth: 1, borderColor: colors.outline, overflow: 'hidden' }}>
          {isLoading
            ? [0, 1, 2, 3].map((i) => (
                <MotiView key={i} from={{ opacity: 0.3 }} animate={{ opacity: 0.7 }}
                  transition={{ type: 'timing', duration: 800, loop: true, delay: i * 100 }}
                  style={{ height: 80, backgroundColor: colors.surfaceContainerHigh, margin: spacing.md, borderRadius: radii.lg }} />
              ))
            : DOCUMENT_CONFIG.map((cfg, i) => (
                <View key={cfg.type} style={i < DOCUMENT_CONFIG.length - 1 ? { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant } : undefined}>
                  <DocumentRow
                    config={cfg}
                    doc={getDoc(cfg.type)}
                    onUpload={handleUpload}
                    uploading={uploadingType === cfg.type}
                    colors={colors}
                  />
                </View>
              ))}
        </MotiView>

        {/* Info note */}
        <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 400, delay: 200 }}
          style={{ flexDirection: 'row', gap: spacing.md, backgroundColor: `${colors.primary}14`, borderRadius: radii.xl, borderWidth: 1, borderColor: `${colors.primary}33`, padding: spacing.base }}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} style={{ marginTop: 2 }} />
          <Text variant="bodySmall" color={colors.onSurfaceVariant} style={{ flex: 1, lineHeight: 20 }}>
            All documents are verified by the EyeGo team within 1–2 business days. You must have all documents verified to unlock full trip access.
          </Text>
        </MotiView>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (colors: DriverColors) => StyleSheet.create({
  docRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.base,
    gap: spacing.md,
  },
  docIconBg: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docLabel: {
    fontFamily: fonts.semiBold,
    fontSize: fontSizes.bodyMedium,
    color: colors.onSurface,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.full,
    borderWidth: 1,
  },
  statusText: { fontFamily: fonts.semiBold, fontSize: 11 },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${colors.primary}18`,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: `${colors.primary}44`,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  uploadText: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.primary },
});
