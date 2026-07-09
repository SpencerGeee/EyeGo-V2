import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { fonts, type ColorTokens } from '@eyego/config';
import { Text } from './Text';
import { getInitials } from '@eyego/utils';
import { useThemedColors } from './ColorsContext';

interface AvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: number;
  borderColor?: string;
}

export function Avatar({ uri, name, size = 44, borderColor }: AvatarProps) {
  const colors = useThemedColors();
  const styles = getStyles(colors);
  const radius = size / 2;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[
          styles.image,
          {
            width: size,
            height: size,
            borderRadius: radius,
            borderWidth: borderColor ? 2 : 0,
            borderColor: borderColor ?? 'transparent',
          },
        ]}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        {
          width: size,
          height: size,
          borderRadius: radius,
          borderWidth: borderColor ? 2 : 0,
          borderColor: borderColor ?? 'transparent',
        },
      ]}
    >
      <Text
        style={{
          fontFamily: fonts.semiBold,
          fontSize: size * 0.35,
          lineHeight: Math.round(size * 0.35 * 1.3),
          color: colors.onSurfaceVariant,
        }}
      >
        {name ? getInitials(name) : '?'}
      </Text>
    </View>
  );
}

function getStyles(colors: ColorTokens) {
  return StyleSheet.create({
    image: {
      resizeMode: 'cover',
    },
    fallback: {
      backgroundColor: colors.surfaceContainerHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
