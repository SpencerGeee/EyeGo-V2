import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect, Text as SvgText, Line } from 'react-native-svg';
import { fonts, fontSizes, spacing } from '@eyego/config';
import { Text } from '@eyego/ui';
import { useColors } from '../utils/useColors';

export interface ChartDataPoint {
  label: string;
  value: number;
}

interface Props {
  period: 'today' | 'week' | 'month';
  data?: ChartDataPoint[];
}

function getFallbackData(period: 'today' | 'week' | 'month'): ChartDataPoint[] {
  if (period === 'today') {
    return [
      { label: '8am', value: 0 },
      { label: '10am', value: 0 },
      { label: '12pm', value: 0 },
      { label: '2pm', value: 0 },
      { label: '4pm', value: 0 },
      { label: '6pm', value: 0 },
    ];
  }
  if (period === 'week') {
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => ({ label, value: 0 }));
  }
  return ['W1', 'W2', 'W3', 'W4'].map((label) => ({ label, value: 0 }));
}

export function EarningsChart({ period, data: propData }: Props) {
  const colors = useColors();
  const data = useMemo(
    () => (propData && propData.length > 0 ? propData : getFallbackData(period)),
    [propData, period],
  );

  const chartWidth = 280;
  const chartHeight = 120;
  const barGap = 8;
  const labelHeight = 20;
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const barWidth = (chartWidth - barGap * (data.length - 1)) / data.length;
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <View style={styles.container}>
      <View style={styles.totalRow}>
        <Text variant="caption" color={colors.onSurfaceVariant}>
          {period === 'today' ? 'Today' : period === 'week' ? 'This Week' : 'This Month'}
        </Text>
        <Text style={[styles.totalAmount, { color: colors.onSurface }]}>GHS {total.toFixed(2)}</Text>
      </View>

      <Svg width={chartWidth} height={chartHeight + labelHeight} style={styles.chart}>
        {data.map((bar, i) => {
          const barHeight = bar.value > 0 ? Math.max((bar.value / maxValue) * chartHeight, 4) : 4;
          const x = i * (barWidth + barGap);
          const y = chartHeight - barHeight;
          const isMax = bar.value > 0 && bar.value === maxValue;

          return (
            <React.Fragment key={bar.label}>
              <Rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={6}
                fill={isMax ? colors.primary : `${colors.primary}55`}
              />
              <SvgText
                x={x + barWidth / 2}
                y={chartHeight + labelHeight - 2}
                textAnchor="middle"
                fontSize={9}
                fill={colors.onSurfaceVariant}
                fontFamily={fonts.regular}
              >
                {bar.label}
              </SvgText>
            </React.Fragment>
          );
        })}
        <Line
          x1={0}
          y1={chartHeight}
          x2={chartWidth}
          y2={chartHeight}
          stroke={colors.outline}
          strokeWidth={1}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalAmount: {
    fontFamily: fonts.displayBold,
    fontSize: fontSizes.titleMedium,
  },
  chart: { alignSelf: 'center' },
});
