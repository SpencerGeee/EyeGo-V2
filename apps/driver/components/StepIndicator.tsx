import React from 'react';
import { View, StyleSheet } from 'react-native';
import { MotiView } from 'moti';
import { spacing, radii } from '@eyego/config';
import { driverColors } from '../utils/useColors';

interface Props {
  currentStep: number;
  totalSteps: number;
}

export function StepIndicator({ currentStep, totalSteps }: Props) {
  return (
    <View style={styles.container}>
      {Array.from({ length: totalSteps }, (_, i) => {
        const stepNum = i + 1;
        const isDone = stepNum < currentStep;
        const isActive = stepNum === currentStep;

        return (
          <React.Fragment key={stepNum}>
            <MotiView
              animate={{
                backgroundColor: isDone || isActive ? driverColors.primary : driverColors.surfaceContainerHighest,
                scale: isActive ? 1.15 : 1,
              }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              style={styles.dot}
            />
            {stepNum < totalSteps && (
              <MotiView
                animate={{
                  backgroundColor: isDone ? driverColors.primary : driverColors.outline,
                }}
                transition={{ type: 'timing', duration: 300 }}
                style={styles.connector}
              />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
    paddingBottom: spacing.md,
    gap: 0,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  connector: {
    flex: 1,
    height: 2,
    maxWidth: 48,
    borderRadius: 1,
    marginHorizontal: 4,
  },
});
