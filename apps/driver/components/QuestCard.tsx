import React from 'react';
import { formatGhs } from '@eyego/utils';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Button } from '@eyego/ui';
import { fonts, fontSizes, spacing, radii } from '@eyego/config';
import { useColors, type DriverColors } from '../utils/useColors';

interface QuestCardProps {
  title: string;
  description: string;
  type: 'RIDES_COUNT' | 'EARNINGS';
  target: number;
  rewardAmountPesewas: number;
  current: number;
  completed: boolean;
  rewardedAt: string | null;
  onClaim?: () => void;
  claiming?: boolean;
}

const QuestCard: React.FC<QuestCardProps> = ({
  title,
  description,
  type,
  target,
  rewardAmountPesewas,
  current,
  completed,
  rewardedAt,
  onClaim,
  claiming,
}) => {
  const colors = useColors();
  const progress = Math.min(current / target, 1);
  const icon = type === 'RIDES_COUNT' ? 'car-outline' : 'cash-outline';

  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceContainer, borderColor: completed ? colors.primary : colors.outline }]}>
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: `${colors.primary}18` }]}>
          <Ionicons name={icon as any} size={20} color={colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text variant="titleSmall">{title}</Text>
          <Text variant="caption" color={colors.onSurfaceVariant}>{description}</Text>
        </View>
        <Text variant="label" color={colors.primary}>
          {formatGhs(rewardAmountPesewas)}
        </Text>
      </View>

      {/* Progress bar */}
      <View style={[styles.progressBg, { backgroundColor: colors.surfaceContainerHigh }]}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${Math.round(progress * 100)}%`,
              backgroundColor: completed ? colors.primary : colors.online,
            },
          ]}
        />
      </View>

      <View style={styles.footer}>
        <Text
          variant="caption"
          color={colors.onSurfaceVariant}
          style={styles.footerProgress}
          numberOfLines={1}
        >
          {type === 'RIDES_COUNT'
            ? `${Math.floor(current)} / ${Math.floor(target)} rides`
            : `${formatGhs(current)} / ${formatGhs(target)}`}
        </Text>
        {completed && !rewardedAt && (
          // BUGFIX (item 19 — "the claim bonus button is distorted"): `Button`
          // defaults to `fullWidth`, so inside this row it claimed 100% of the
          // footer, overlapping the progress caption and stretching itself past
          // the card's padding. It has to size to its label here.
          <View style={styles.footerAction}>
            <Button
              label="Claim Bonus"
              variant="primary"
              fullWidth={false}
              onPress={onClaim}
              loading={claiming}
              disabled={!onClaim || claiming}
            />
          </View>
        )}
        {rewardedAt && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
            <Text variant="caption" color={colors.primary}>Bonus paid</Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: spacing.base,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  progressBg: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  /** Takes the leftover width so a long "GHS x / GHS y" line truncates instead
   *  of pushing the claim button out of the card. */
  footerProgress: { flex: 1, minWidth: 0 },
  /** The claim button sizes to its label and never shrinks. */
  footerAction: { flexShrink: 0 },
});

export default QuestCard;
