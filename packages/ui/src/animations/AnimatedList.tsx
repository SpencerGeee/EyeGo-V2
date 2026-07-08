import React, { useCallback } from 'react';
import {
  View,
  type ListRenderItem,
  type StyleProp,
  type ViewStyle,
  type ListRenderItemInfo,
} from 'react-native';
import { FlashList, type FlashListProps } from '@shopify/flash-list';
import { Entrance, type EntranceAnimation } from './Entrance';

/**
 * AnimatedList — a FlashList wrapper that automatically applies staggered
 * entrance animations to items as they first render.
 *
 * Usage:
 *   <AnimatedList
 *     data={items}
 *     renderItem={({ item }) => <ItemCard item={item} />}
 *     entranceAnimation="slideUp"
 *     staggerDelay={40}
 *   />
 *
 * The wrapper intercepts renderItem to wrap each visible cell in an Entrance
 * with an incrementing stagger delay (index * staggerDelay). Only animates
 * on mount — re-renders don't re-trigger because Entrance memoizes its config.
 */
export interface AnimatedListProps<T> extends Omit<FlashListProps<T>, 'renderItem'> {
  /** Entrance animation for each item. Default: 'slideUp' */
  entranceAnimation?: EntranceAnimation;
  /** Delay increment per item (ms). Default: 40 */
  staggerDelay?: number;
  /** Duration per item entrance (ms). Default: 200 */
  entranceDuration?: number;
  /** Custom render item — receives the same props as FlashList's renderItem. */
  renderItem: ListRenderItem<T>;
  /** Optional style for the list container. */
  style?: StyleProp<ViewStyle>;
}

export function AnimatedList<T>({
  entranceAnimation = 'slideUp',
  staggerDelay = 40,
  entranceDuration = 200,
  renderItem,
  data,
  keyExtractor,
  style,
  ...flashListProps
}: AnimatedListProps<T>) {
  const animatedRenderItem = useCallback(
    (info: ListRenderItemInfo<T>) => {
      const index = info.index;
      const delay = index * staggerDelay;
      const key =
        keyExtractor?.(info.item, index) ??
        (info.item as any)?.id?.toString() ??
        String(index);

      return (
        <Entrance
          key={key}
          animation={entranceAnimation}
          delay={delay}
          duration={entranceDuration}
        >
          {renderItem(info) as React.ReactElement}
        </Entrance>
      );
    },
    [renderItem, entranceAnimation, staggerDelay, entranceDuration, keyExtractor],
  );

  return (
    <View style={style}>
      <FlashList<T>
        data={data}
        renderItem={animatedRenderItem}
        keyExtractor={keyExtractor}
        {...flashListProps}
      />
    </View>
  );
}
