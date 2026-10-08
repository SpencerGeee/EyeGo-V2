import React, { useState } from 'react';
import { Alert, RefreshControl } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { driverApi } from '@eyego/api';
import type { DriverDocument } from '@eyego/api';
import { Ionicons } from '@expo/vector-icons';
import { Screen, ListSection, ListRow, SkeletonRows, QueryBoundary, notify } from '@eyego/ui';
import { useColors, type DriverColors } from '../../utils/useColors';
import { useDriverStore } from '../../stores/driver.store';
import { dayMonthYear } from '@eyego/utils';

const DAY_MS = 86_400_000;
const EXPIRY_WARN_DAYS = 30;

const DOCUMENT_CONFIG: {
  type: DriverDocument['type'];
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { type: 'DRIVERS_LICENSE', label: "Driver's licence", description: "Valid national driver's licence", icon: 'card-outline' },
  { type: 'GHANA_CARD', label: 'Ghana Card', description: 'Valid Ghana Card or national ID', icon: 'id-card-outline' },
  { type: 'PROFILE_PHOTO', label: 'Profile photo', description: 'Clear photo of your face for passenger ID', icon: 'person-circle-outline' },
];

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

/** What the row says on the right, and whether the driver can (re)upload. */
function stateOf(doc: DriverDocument | undefined): { label: string; tone: Tone; actionable: boolean; detail?: string } {
  const status = doc?.status ?? 'MISSING';
  const daysLeft = doc?.expiresAt ? Math.ceil((new Date(doc.expiresAt).getTime() - Date.now()) / DAY_MS) : null;
  const expiry = doc?.expiresAt ? dayMonthYear(doc.expiresAt) : null;
  switch (status) {
    case 'MISSING':
      return { label: 'Upload', tone: 'bad', actionable: true };
    case 'REJECTED':
      return { label: 'Rejected', tone: 'bad', actionable: true, detail: doc?.rejectionReason ?? 'Upload a clearer photo' };
    case 'EXPIRED':
      return { label: 'Expired', tone: 'bad', actionable: true, detail: expiry ? `Expired ${expiry}` : undefined };
    case 'PENDING':
      return { label: 'In review', tone: 'warn', actionable: false, detail: 'Usually 1–2 business days' };
    case 'VERIFIED':
      if (daysLeft != null && daysLeft <= EXPIRY_WARN_DAYS) {
        return { label: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`, tone: 'warn', actionable: true, detail: `Expires ${expiry} — upload the renewed one` };
      }
      return { label: 'Verified', tone: 'ok', actionable: false, detail: expiry ? `Expires ${expiry}` : undefined };
  }
}

const toneColor = (t: Tone, c: DriverColors) =>
  t === 'ok' ? c.statusSuccess : t === 'warn' ? c.statusWarning : t === 'bad' ? c.error : c.onSurfaceVariant;

/**
 * DOCUMENTS (rival spec §18) — each row shows its status and expiry; amber
 * inside 30 days, red when expired or rejected.
 *
 * A verified document inside its 30-day window can now be re-uploaded. Before,
 * Upload only appeared once a document had already EXPIRED — the driver got
 * the warning push and then had no way to act on it until it was too late.
 */
export default function DocumentsScreen() {
  const colors = useColors();
  const qc = useQueryClient();
  const updateDriver = useDriverStore((s) => s.updateDriver);
  const [uploadingType, setUploadingType] = useState<string | null>(null);

  const docsQ = useQuery({
    queryKey: ['driver', 'documents'],
    queryFn: () => driverApi.getDocuments(),
    select: (r) => r.data.data ?? [],
  });
  const documents = docsQ.data;

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
        const result = response?.data?.data as Record<string, unknown> | undefined;
        const url: string | undefined = [result?.profilePhotoUrl, result?.documentUrl, result?.url]
          .find((v): v is string => typeof v === 'string');
        if (url) updateDriver({ profilePhoto: url, avatarUrl: url });
      }
      // A profile photo is not reviewed — the server says which it is.
      const payload = response?.data?.data as { requiresReview?: boolean } | undefined;
      const needsReview = payload?.requiresReview ?? type !== 'PROFILE_PHOTO';
      notify(
        needsReview ? 'Submitted for review' : 'Photo updated',
        needsReview
          ? 'Your document has been submitted for review. Verification usually takes 1–2 business days.'
          : 'Your profile photo is live — passengers will see it on your next trip.',
        { tone: 'success' },
      );
    },
    onError: (err) => notify('Upload failed', (err as Error).message),
    onSettled: () => setUploadingType(null),
  });

  /**
   * Renewing a still-valid licence sends it back to review, and go-online needs
   * it VERIFIED — so an early renewal takes the driver offline until approved.
   * Say so before they do it.
   */
  const onRowPress = (type: DriverDocument['type'], doc: DriverDocument | undefined) => {
    if (doc?.status !== 'VERIFIED') return handleUpload(type);
    Alert.alert(
      'Upload your renewed licence?',
      'It goes back to review (usually 1–2 business days), and you can’t go online until it’s approved. Upload it close to the expiry date to stay on the road.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Upload', onPress: () => handleUpload(type) },
      ],
    );
  };

  const handleUpload = async (type: DriverDocument['type']) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      notify('Permission required', 'Allow access to your photos to upload documents.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
    });
    if (result.canceled || !result.assets[0]) return;
    setUploadingType(type);
    upload.mutate({ type, uri: result.assets[0].uri });
  };

  const verified = DOCUMENT_CONFIG.filter((c) => documents?.find((d) => d.type === c.type)?.status === 'VERIFIED').length;

  return (
    <Screen
      title="Documents"
      subtitle={documents ? `${verified} of ${DOCUMENT_CONFIG.length} verified` : undefined}
      refreshControl={<RefreshControl refreshing={docsQ.isRefetching} onRefresh={() => docsQ.refetch()} tintColor={colors.primary} />}
    >
      <QueryBoundary
        loading={docsQ.isLoading}
        error={docsQ.isError && !documents}
        onRetry={() => docsQ.refetch()}
        skeleton={<SkeletonRows count={3} />}
      >
        <ListSection footer="Your licence and Ghana Card are checked by the EyeGo team within 1–2 business days; both must be verified for full trip access. Your profile photo isn’t reviewed — it goes live when you upload it.">
          {DOCUMENT_CONFIG.map((cfg) => {
            const doc = documents?.find((d) => d.type === cfg.type);
            const st = stateOf(doc);
            const busy = uploadingType === cfg.type;
            return (
              <ListRow
                key={cfg.type}
                icon={cfg.icon}
                title={cfg.label}
                subtitle={busy ? 'Uploading…' : st.detail ?? cfg.description}
                value={st.label}
                valueColor={toneColor(st.tone, colors)}
                onPress={st.actionable && !busy ? () => onRowPress(cfg.type, doc) : undefined}
                disabled={busy}
                accessibilityHint={st.actionable ? 'Choose a photo to upload' : undefined}
              />
            );
          })}
        </ListSection>
      </QueryBoundary>
    </Screen>
  );
}
