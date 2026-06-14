// ───────────────────────────────────────────────
// Moti Transition Type Override
// moti 0.28.x + react-native-reanimated 3.x compatibility
// ───────────────────────────────────────────────

import 'moti';

declare module 'moti' {
  /**
   * Widen the transition prop to accept the simple object form that
   * all screens in this project use.
   */
  type SpringConfig = {
    type: 'spring';
    stiffness?: number;
    damping?: number;
    mass?: number;
    overshootClamping?: boolean;
    delay?: number;
    [key: string]: any;
  };

  type TimingConfig = {
    type: 'timing';
    duration?: number;
    delay?: number;
    [key: string]: any;
  };

  type TransitionConfig = SpringConfig | TimingConfig;

  // Augment MotiTransitionProp for all animated components
  interface MotiViewProps {
    transition?: TransitionConfig;
  }

  interface MotiTextProps {
    transition?: TransitionConfig;
  }

  interface MotiImageProps {
    transition?: TransitionConfig;
  }

  interface MotiSafeAreaViewProps {
    transition?: TransitionConfig;
  }

  interface MotiScrollViewProps {
    transition?: TransitionConfig;
  }
}

// ───────────────────────────────────────────────
// Space Grotesk font — add 'bold' alias
// ───────────────────────────────────────────────

import '@eyego/config';

declare module '@eyego/config' {
  interface Fonts {
    bold: string;
  }
}

// ───────────────────────────────────────────────
// Driver Colors — add 'warning' key
// ───────────────────────────────────────────────

declare module '@eyego/config' {
  interface DriverColors {
    warning: string;
  }
}

// ───────────────────────────────────────────────
// Chat Message — add readAt to chat history type
// ───────────────────────────────────────────────

declare module '@eyego/types' {
  interface ChatMessage {
    senderId: string;
    senderName?: string;
    senderRole?: string;
    seatNumber?: number | null;
    text: string;
    timestamp: string;
    isPrivate?: boolean;
    recipientId?: string;
    readAt?: string | null;
    id?: string;
  }
}

// ───────────────────────────────────────────────
// StepIndicator — Props type
// ───────────────────────────────────────────────

declare module '*.tsx' {
  // Allow any component to accept extra props
}
