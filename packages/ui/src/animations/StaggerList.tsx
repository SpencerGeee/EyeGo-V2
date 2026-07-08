import React, { Children, isValidElement } from 'react';
import { Entrance, type EntranceAnimation } from './Entrance';

/**
 * Staggered entrance wrapper — wraps each direct child in an `Entrance` with
 * an incrementing delay so items reveal in sequence.
 *
 * Usage:
 *   <StaggerList staggerDelay={50} animation="slideUp">
 *     <Item1 />
 *     <Item2 />
 *     <Item3 />
 *   </StaggerList>
 *
 * The staggerDelay is multiplied by each child's index. If children have a
 * `.key` prop it's used as the React key; otherwise the index is used.
 * Wraps Fragment children generically — works with any React element type.
 */
export interface StaggerListProps {
  children: React.ReactNode;
  /** Delay increment per child (ms). Default: 40 */
  staggerDelay?: number;
  /** Entrance animation variant. Default: 'slideUp' */
  animation?: EntranceAnimation;
  /** Duration per entrance (ms). Default: 200 */
  duration?: number;
}

export function StaggerList({
  children,
  staggerDelay = 40,
  animation = 'slideUp',
  duration = 200,
}: StaggerListProps) {
  return (
    <>
      {Children.map(children, (child, index) => {
        if (!isValidElement(child)) return child;

        const delay = index * staggerDelay;

        return (
          <Entrance
            key={(child as React.ReactElement<{ key?: string | number }>).key ?? index}
            animation={animation}
            delay={delay}
            duration={duration}
          >
            {child}
          </Entrance>
        );
      })}
    </>
  );
}
