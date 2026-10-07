import React, { useState } from 'react';
import { formatGhs } from '@eyego/utils';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect, Text as SvgText, Line } from 'react-native-svg';
import { fonts } from '@eyego/config';
import { Text } from '@eyego/ui';
import { useColors } from '../utils/useColors';

export interface ChartDataPoint {
  label: string;
  value: number;
}

interface Props {
  period: 'today' | 'week' | 'month';
  data: ChartDataPoint[];
}

const CHART_HEIGHT = 120;
const LABEL_HEIGHT = 20;
const BAR_GAP = 8;

/**
 * Period total + bars. Sized to its container (was a fixed 280pt island in the
 * middle of a wide card), and the total is the period's headline number.
 */
export function EarningsChart({ period, data }: Props) {
  const colors = useColors();
  const [width, setWidth] = useState(0);

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const barWidth = data.length ? Math.max(4, (width - BAR_GAP * (data.length - 1)) / data.length) : 0;
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <View style={styles.container}>
      <Text variant="labelCaps" color={colors.onSurfaceVariant}>
        {period === 'today' ? 'Today' : period === 'week' ? 'This week' : 'This month'}
      </Text>
      <Text style={[styles.total, { color: colors.onSurface }]} accessibilityLabel={`Earned ${formatGhs(total)}`}>
        {formatGhs(total)}
      </Text>

      <View onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))} style={styles.chartBox}>
        {width > 0 ? (
          <Svg width={width} height={CHART_HEIGHT + LABEL_HEIGHT}>
            {data.map((bar, i) => {
              const barHeight = bar.value > 0 ? Math.max((bar.value / maxValue) * CHART_HEIGHT, 4) : 3;
              const x = i * (barWidth + BAR_GAP);
              const isMax = bar.value > 0 && bar.value === maxValue;
              return (
                <React.Fragment key={`${bar.label}-${i}`}>
                  <Rect
                    x={x}
                    y={CHART_HEIGHT - barHeight}
                    width={barWidth}
                    height={barHeight}
                    rx={Math.min(6, barWidth / 2)}
                    fill={isMax ? colors.primary : `${colors.primary}55`}
                  />
                  <SvgText
                    x={x + barWidth / 2}
                    y={CHART_HEIGHT + LABEL_HEIGHT - 4}
                    textAnchor="middle"
                    fontSize={10}
                    fill={colors.onSurfaceVariant}
                    fontFamily={fonts.regular}
                  >
                    {bar.label}
                  </SvgText>
                </React.Fragment>
              );
            })}
            <Line x1={0} y1={CHART_HEIGHT} x2={width} y2={CHART_HEIGHT} stroke={colors.outlineVariant} strokeWidth={1} />
          </Svg>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  total: { fontFamily: fonts.displayBold, fontSize: 34, lineHeight: 40, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  chartBox: { marginTop: 16, height: CHART_HEIGHT + LABEL_HEIGHT },
});
