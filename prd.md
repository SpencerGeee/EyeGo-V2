# EyeGo — React Native + Expo PRD
### Version 2.0 | React Native + Expo Monorepo
### Agent-Optimised: Claude Code / Antigravity / GLM 5.1
### Last Updated: May 2026

---

> **CRITICAL INSTRUCTION FOR ALL AGENTS:** This document is the single source of truth.
> Do not make architectural decisions not specified here. Do not install packages not listed here.
> Do not create files in locations not specified here. Do not deviate from the patterns shown.
> When in doubt, ask — do not assume and proceed.

---

## TABLE OF CONTENTS

1. [Project Overview](#1-project-overview)
2. [Why React Native + Expo (Not Flutter)](#2-why-react-native--expo-not-flutter)
3. [Monorepo Architecture](#3-monorepo-architecture)
4. [Exact Package Manifest](#4-exact-package-manifest)
5. [Complete Folder Structure](#5-complete-folder-structure)
6. [Design System Implementation](#6-design-system-implementation)
7. [Navigation Architecture](#7-navigation-architecture)
8. [State Management Architecture](#8-state-management-architecture)
9. [API Client Setup](#9-api-client-setup)
10. [WebSocket Client Setup](#10-websocket-client-setup)
11. [Authentication Implementation](#11-authentication-implementation)
12. [Animation System](#12-animation-system)
13. [Rider App — Screen Specifications](#13-rider-app--screen-specifications)
14. [Driver App — Screen Specifications](#14-driver-app--screen-specifications)
15. [Shared Components Library](#15-shared-components-library)
16. [Maps Implementation](#16-maps-implementation)
17. [Payment Implementation](#17-payment-implementation)
18. [Push Notifications](#18-push-notifications)
19. [No-Mac iOS Workflow](#19-no-mac-ios-workflow)
20. [EAS Build Configuration](#20-eas-build-configuration)
21. [Environment Configuration](#21-environment-configuration)
22. [Agent Prompt Templates](#22-agent-prompt-templates)
23. [Build Order & Milestones](#23-build-order--milestones)

---

## 1. Project Overview

### 1.1 What We Are Building

Two production React Native apps sharing one codebase:

| App | Package Name | Platform Target | Primary Colour |
|---|---|---|---|
| **EyeGo Rider** | `com.eyego.rider` | Android + iOS | Eco Green `#1DB954` |
| **EyeGo Driver** | `com.eyego.driver` | Android + iOS (Android primary) | Driver Orange `#FF6B00` |

The backend is **already built in Node.js**. Do not touch or rewrite the backend. The mobile apps consume it via REST API and WebSocket.

### 1.2 Repository Structure

```
eyego/                          ← Root monorepo
├── apps/
│   ├── rider/                  ← EyeGo Rider Expo app
│   └── driver/                 ← EyeGo Driver Expo app
├── packages/
│   ├── ui/                     ← Shared component library
│   ├── api/                    ← Shared API + WebSocket client
│   ├── types/                  ← Shared TypeScript types
│   ├── config/                 ← Design tokens, constants
│   └── utils/                  ← Shared utility functions
└── backend/                    ← Existing Node.js — DO NOT MODIFY
```

---

## 2. Why React Native + Expo (Not Flutter)

This section exists so agents understand the core rendering philosophy and don't introduce Flutter patterns.

**Flutter** renders every pixel on its own canvas. It does not use native iOS or Android UI components. A Flutter app on iOS is not an iOS app — it is a simulation of an app inside a canvas.

**React Native** renders actual native components. On iOS, a `<ScrollView>` is a real `UIScrollView`. A `<TextInput>` is a real `UITextField`. Navigation gestures use the real iOS gesture recogniser. This is why RN apps feel native and Flutter apps feel slightly foreign on iOS.

**Expo** is a layer on top of React Native that provides:
- Expo Go: test on a physical device without building
- EAS Build: build iOS `.ipa` files from the cloud (no Mac required)
- EAS Submit: submit to App Store / Play Store from CLI
- Over-the-air (OTA) updates: push JS updates without App Store review
- Managed workflow: handles native config without touching Xcode

**Agent rule:** Never suggest ejecting from Expo managed workflow. Never suggest adding bare React Native code outside the Expo SDK. If a feature seems to require it, check Expo's SDK documentation first.

---

## 3. Monorepo Architecture

### 3.1 Root package.json

```json
{
  "name": "eyego",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "rider": "yarn workspace @eyego/rider start",
    "driver": "yarn workspace @eyego/driver start",
    "rider:android": "yarn workspace @eyego/rider android",
    "driver:android": "yarn workspace @eyego/driver android",
    "typecheck": "yarn workspaces run typecheck",
    "lint": "yarn workspaces run lint"
  },
  "devDependencies": {
    "typescript": "~5.3.3"
  },
  "packageManager": "yarn@3.6.4"
}
```

### 3.2 Shared Package Names

All internal packages use the `@eyego/` scope:

| Package | Import Path | Purpose |
|---|---|---|
| `@eyego/config` | `import { colors } from '@eyego/config'` | Design tokens, constants |
| `@eyego/types` | `import type { Ride } from '@eyego/types'` | TypeScript interfaces |
| `@eyego/api` | `import { apiClient } from '@eyego/api'` | Axios instance + all API calls |
| `@eyego/ui` | `import { Button } from '@eyego/ui'` | All shared components |
| `@eyego/utils` | `import { formatGHS } from '@eyego/utils'` | Pure utility functions |

### 3.3 Why Yarn Workspaces (Not npm)

Expo monorepos work most reliably with Yarn workspaces. npm workspaces have known issues with Expo's Metro bundler resolving workspace packages. Use Yarn exclusively throughout this project.

---

## 4. Exact Package Manifest

> **AGENT RULE:** Install ONLY these packages. Do not install alternatives.
> Do not upgrade to a newer major version without explicit instruction.
> These versions are tested to work together with Expo SDK 51.

### 4.1 Both Apps (apps/rider + apps/driver)

```json
{
  "dependencies": {
    "expo": "~51.0.0",
    "expo-router": "~3.5.0",
    "react": "18.2.0",
    "react-native": "0.74.5",

    "react-native-reanimated": "~3.10.0",
    "react-native-gesture-handler": "~2.16.0",
    "react-native-screens": "~3.31.0",
    "react-native-safe-area-context": "4.10.1",

    "nativewind": "^4.0.1",
    "tailwindcss": "^3.4.0",

    "expo-secure-store": "~13.0.0",
    "expo-notifications": "~0.28.0",
    "expo-font": "~12.0.0",
    "expo-splash-screen": "~0.27.0",
    "expo-status-bar": "~1.12.0",
    "expo-image-picker": "~15.0.0",
    "expo-local-authentication": "~14.0.0",
    "expo-linking": "~6.3.0",
    "expo-constants": "~16.0.0",

    "moti": "^0.29.0",
    "@shopify/flash-list": "1.6.3",

    "zustand": "^4.5.0",
    "@tanstack/react-query": "^5.40.0",
    "axios": "^1.7.0",

    "socket.io-client": "^4.7.0",

    "@rnmapbox/maps": "10.1.30",

    "react-native-svg": "15.2.0",
    "@expo/vector-icons": "^14.0.0",
    "lucide-react-native": "^0.378.0",

    "lottie-react-native": "7.0.0",

    "@gorhom/bottom-sheet": "^4.6.4",

    "react-native-toast-message": "^2.2.0",

    "date-fns": "^3.6.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@babel/core": "^7.24.0",
    "@types/react": "~18.2.45",
    "@types/react-native": "~0.73.0",
    "typescript": "~5.3.3",
    "eslint": "^8.57.0",
    "eslint-config-expo": "~7.0.0",
    "prettier": "^3.3.0"
  }
}
```

### 4.2 Rider App Only

```json
{
  "dependencies": {
    "@eyego/config": "*",
    "@eyego/types": "*",
    "@eyego/api": "*",
    "@eyego/ui": "*",
    "@eyego/utils": "*",
    "@react-native-google-signin/google-signin": "^13.0.0",
    "expo-apple-authentication": "~6.4.0"
  }
}
```

### 4.3 Driver App Only

```json
{
  "dependencies": {
    "@eyego/config": "*",
    "@eyego/types": "*",
    "@eyego/api": "*",
    "@eyego/ui": "*",
    "@eyego/utils": "*",
    "expo-task-manager": "~11.8.0",
    "expo-location": "~17.0.0"
  }
}
```

### 4.4 Shared Packages (packages/*)

Each shared package needs its own minimal `package.json`:

```json
// packages/config/package.json
{
  "name": "@eyego/config",
  "version": "1.0.0",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

Same pattern for `@eyego/types`, `@eyego/api`, `@eyego/ui`, `@eyego/utils`.

---

## 5. Complete Folder Structure

```
eyego/
│
├── apps/
│   │
│   ├── rider/
│   │   ├── app/                          ← Expo Router file-based routes
│   │   │   ├── _layout.tsx               ← Root layout (providers, fonts)
│   │   │   ├── index.tsx                 ← Redirects to /home or /auth
│   │   │   ├── (auth)/
│   │   │   │   ├── _layout.tsx
│   │   │   │   ├── phone.tsx             ← Phone number entry
│   │   │   │   ├── otp.tsx               ← OTP verification
│   │   │   │   ├── register.tsx          ← Profile completion
│   │   │   │   └── social.tsx            ← Google/Apple
│   │   │   ├── (onboarding)/
│   │   │   │   ├── _layout.tsx
│   │   │   │   └── index.tsx             ← 3-slide onboarding
│   │   │   ├── (tabs)/
│   │   │   │   ├── _layout.tsx           ← Bottom tab navigator
│   │   │   │   ├── home.tsx              ← Map home screen
│   │   │   │   ├── trips.tsx             ← Trip history
│   │   │   │   ├── notifications.tsx
│   │   │   │   └── profile.tsx
│   │   │   ├── ride/
│   │   │   │   ├── select.tsx            ← Route + tier selection
│   │   │   │   ├── [id].tsx              ← Ride detail
│   │   │   │   ├── [id]/
│   │   │   │   │   ├── invite.tsx        ← Share link
│   │   │   │   │   ├── payment.tsx       ← Payment screen
│   │   │   │   │   ├── tracking.tsx      ← Live tracking
│   │   │   │   │   └── complete.tsx      ← Post-ride rating
│   │   │   └── join/
│   │   │       └── [token].tsx           ← Deep link handler
│   │   ├── assets/
│   │   │   ├── fonts/
│   │   │   │   ├── ClashDisplay-Bold.otf
│   │   │   │   ├── ClashDisplay-ExtraBold.otf
│   │   │   │   ├── Satoshi-Regular.otf
│   │   │   │   ├── Satoshi-Medium.otf
│   │   │   │   ├── Satoshi-SemiBold.otf
│   │   │   │   ├── Satoshi-Bold.otf
│   │   │   │   ├── JetBrainsMono-Bold.ttf
│   │   │   │   └── JetBrainsMono-Regular.ttf
│   │   │   ├── lottie/
│   │   │   │   ├── splash-logo.json
│   │   │   │   ├── payment-success.json
│   │   │   │   ├── boarded-check.json
│   │   │   │   └── empty-state.json
│   │   │   └── images/
│   │   │       ├── icon.png
│   │   │       └── splash.png
│   │   ├── app.json
│   │   ├── app.config.ts
│   │   ├── babel.config.js
│   │   ├── metro.config.js
│   │   ├── tailwind.config.js
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── driver/
│       ├── app/
│       │   ├── _layout.tsx
│       │   ├── index.tsx
│       │   ├── (auth)/
│       │   │   └── [same auth screens as rider]
│       │   ├── (tabs)/
│       │   │   ├── _layout.tsx
│       │   │   ├── home.tsx              ← Driver dashboard
│       │   │   ├── trips.tsx
│       │   │   └── earnings.tsx
│       │   ├── register/
│       │   │   ├── profile.tsx
│       │   │   ├── vehicle.tsx
│       │   │   └── documents.tsx
│       │   ├── pending.tsx               ← Awaiting approval
│       │   ├── ride/
│       │   │   ├── [id].tsx              ← Active ride view
│       │   │   ├── [id]/
│       │   │   │   ├── manifest.tsx      ← Passenger list
│       │   │   │   └── add-passenger.tsx ← Cash passenger flow
│       │   └── wallet.tsx
│       ├── assets/                       ← Same structure as rider
│       ├── app.json
│       ├── app.config.ts
│       ├── babel.config.js
│       ├── metro.config.js
│       ├── tailwind.config.js
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   │
│   ├── config/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── colors.ts                 ← All design tokens
│   │       ├── typography.ts             ← Font names + size scale
│   │       ├── spacing.ts                ← Spacing scale
│   │       └── constants.ts             ← API URLs, limits, etc.
│   │
│   ├── types/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── user.types.ts
│   │       ├── ride.types.ts
│   │       ├── booking.types.ts
│   │       ├── payment.types.ts
│   │       ├── driver.types.ts
│   │       └── api.types.ts              ← Response envelopes
│   │
│   ├── api/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── client.ts                 ← Axios instance + interceptors
│   │       ├── socket.ts                 ← Socket.io client
│   │       ├── endpoints/
│   │       │   ├── auth.api.ts
│   │       │   ├── rides.api.ts
│   │       │   ├── bookings.api.ts
│   │       │   ├── payments.api.ts
│   │       │   ├── drivers.api.ts
│   │       │   ├── routes.api.ts
│   │       │   └── notifications.api.ts
│   │       └── queryKeys.ts              ← TanStack Query key factory
│   │
│   ├── ui/
│   │   └── src/
│   │       ├── index.ts                  ← Barrel exports
│   │       ├── components/
│   │       │   ├── Button.tsx
│   │       │   ├── Input.tsx
│   │       │   ├── OTPInput.tsx
│   │       │   ├── Card.tsx
│   │       │   ├── RideCard.tsx
│   │       │   ├── TierSelector.tsx
│   │       │   ├── SeatBar.tsx
│   │       │   ├── SeatBadge.tsx
│   │       │   ├── DriverInfoCard.tsx
│   │       │   ├── StatusBadge.tsx
│   │       │   ├── TierBadge.tsx
│   │       │   ├── BottomSheet.tsx
│   │       │   ├── Toast.tsx
│   │       │   ├── Skeleton.tsx
│   │       │   ├── EmptyState.tsx
│   │       │   ├── Avatar.tsx
│   │       │   ├── Toggle.tsx
│   │       │   └── AnimatedFareText.tsx
│   │       └── primitives/
│   │           ├── Text.tsx              ← Typography primitive
│   │           ├── Box.tsx               ← View primitive
│   │           └── Pressable.tsx         ← Animated pressable
│   │
│   └── utils/
│       └── src/
│           ├── index.ts
│           ├── format.ts                 ← formatGHS, formatDate, etc.
│           ├── validation.ts             ← Phone, OTP validators
│           ├── fare.ts                   ← Fare calculation helpers
│           └── storage.ts               ← SecureStore wrappers
│
└── backend/                              ← DO NOT MODIFY — existing Node.js
```

---

## 6. Design System Implementation

### 6.1 Colors (packages/config/src/colors.ts)

```typescript
export const colors = {
  // Backgrounds
  background: '#0A0A0A',
  surface: '#141414',
  surfaceElevated: '#1E1E1E',
  surfaceOverlay: '#252525',
  divider: 'rgba(255, 255, 255, 0.06)',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#A0A0A0',
  textTertiary: '#4A4A4A',
  textInverse: '#0A0A0A',

  // Eco (Rider primary)
  ecoGreen: '#1DB954',
  ecoGreenDim: '#17833C',
  ecoGreenSubtle: 'rgba(29, 185, 84, 0.12)',

  // Comfort
  comfortBlue: '#0066FF',
  comfortBlueDim: '#0052CC',
  comfortBlueSubtle: 'rgba(0, 102, 255, 0.12)',

  // Driver
  driverOrange: '#FF6B00',
  driverOrangeDim: '#CC5500',
  driverOrangeSubtle: 'rgba(255, 107, 0, 0.12)',

  // Semantic
  warning: '#FFB800',
  warningSubtle: 'rgba(255, 184, 0, 0.12)',
  error: '#FF3B30',
  errorSubtle: 'rgba(255, 59, 48, 0.12)',
  success: '#30D158',
  successSubtle: 'rgba(48, 209, 88, 0.12)',

  // Map
  mapOverlay: 'rgba(10, 10, 10, 0.78)',
  mapOverlayLight: 'rgba(10, 10, 10, 0.45)',

  // Light mode equivalents
  light: {
    background: '#F5F5F5',
    surface: '#FFFFFF',
    surfaceElevated: '#F0F0F0',
    surfaceOverlay: '#E8E8E8',
    divider: 'rgba(0, 0, 0, 0.08)',
    textPrimary: '#0A0A0A',
    textSecondary: '#6B6B6B',
    textTertiary: '#BBBBBB',
    textInverse: '#FFFFFF',
  },
} as const;

export type ColorKey = keyof typeof colors;
```

### 6.2 Typography (packages/config/src/typography.ts)

```typescript
// Font family names must EXACTLY match the filenames registered in app.json
export const fonts = {
  displayBold: 'ClashDisplay-Bold',
  displayExtraBold: 'ClashDisplay-ExtraBold',
  regular: 'Satoshi-Regular',
  medium: 'Satoshi-Medium',
  semiBold: 'Satoshi-SemiBold',
  bold: 'Satoshi-Bold',
  monoBold: 'JetBrainsMono-Bold',
  monoRegular: 'JetBrainsMono-Regular',
} as const;

export const fontSizes = {
  // Display (Clash Display only)
  hero: 48,
  display: 36,
  headlineLarge: 28,

  // Titles (Satoshi)
  titleLarge: 22,
  titleMedium: 18,
  titleSmall: 16,

  // Body (Satoshi)
  bodyLarge: 16,
  bodyMedium: 14,
  bodySmall: 12,
  label: 13,
  caption: 11,

  // Mono (JetBrains Mono)
  fareLarge: 32,
  fareMedium: 24,
  fareSmall: 18,
  fareInline: 14,
} as const;

export const lineHeights = {
  display: 1.1,
  title: 1.2,
  body: 1.4,
  caption: 1.3,
} as const;
```

### 6.3 Font Loading in app/_layout.tsx

This pattern MUST be used in both `apps/rider/app/_layout.tsx` and `apps/driver/app/_layout.tsx`:

```tsx
import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    'ClashDisplay-Bold': require('../assets/fonts/ClashDisplay-Bold.otf'),
    'ClashDisplay-ExtraBold': require('../assets/fonts/ClashDisplay-ExtraBold.otf'),
    'Satoshi-Regular': require('../assets/fonts/Satoshi-Regular.otf'),
    'Satoshi-Medium': require('../assets/fonts/Satoshi-Medium.otf'),
    'Satoshi-SemiBold': require('../assets/fonts/Satoshi-SemiBold.otf'),
    'Satoshi-Bold': require('../assets/fonts/Satoshi-Bold.otf'),
    'JetBrainsMono-Bold': require('../assets/fonts/JetBrainsMono-Bold.ttf'),
    'JetBrainsMono-Regular': require('../assets/fonts/JetBrainsMono-Regular.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return <Stack screenOptions={{ headerShown: false }} />;
}
```

### 6.4 NativeWind Setup

NativeWind brings Tailwind CSS syntax to React Native. This is the primary styling approach.

**tailwind.config.js (same for both apps):**

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    '../../packages/ui/src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: '#0A0A0A',
        surface: '#141414',
        'surface-elevated': '#1E1E1E',
        'eco-green': '#1DB954',
        'eco-green-dim': '#17833C',
        'comfort-blue': '#0066FF',
        'driver-orange': '#FF6B00',
        warning: '#FFB800',
        error: '#FF3B30',
        success: '#30D158',
        'text-primary': '#FFFFFF',
        'text-secondary': '#A0A0A0',
        'text-tertiary': '#4A4A4A',
      },
      fontFamily: {
        'display-bold': ['ClashDisplay-Bold'],
        'display-extrabold': ['ClashDisplay-ExtraBold'],
        sans: ['Satoshi-Regular'],
        'sans-medium': ['Satoshi-Medium'],
        'sans-semibold': ['Satoshi-SemiBold'],
        'sans-bold': ['Satoshi-Bold'],
        'mono-bold': ['JetBrainsMono-Bold'],
        mono: ['JetBrainsMono-Regular'],
      },
      borderRadius: {
        chip: '8px',
        card: '14px',
        sheet: '24px',
        modal: '28px',
      },
    },
  },
  plugins: [],
};
```

**babel.config.js (both apps):**

```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      'react-native-reanimated/plugin', // MUST be last plugin
    ],
  };
};
```

### 6.5 Typography Primitive (packages/ui/src/primitives/Text.tsx)

All text in the app uses this component. Never use React Native's raw `<Text>`:

```tsx
import React from 'react';
import { Text as RNText, TextProps, TextStyle } from 'react-native';
import { fonts, fontSizes } from '@eyego/config';

type TextVariant =
  | 'hero'
  | 'display'
  | 'headlineLarge'
  | 'titleLarge'
  | 'titleMedium'
  | 'titleSmall'
  | 'bodyLarge'
  | 'bodyMedium'
  | 'bodySmall'
  | 'label'
  | 'caption'
  | 'fareLarge'
  | 'fareMedium'
  | 'fareSmall'
  | 'fareInline';

const variantStyles: Record<TextVariant, TextStyle> = {
  hero: { fontFamily: fonts.displayExtraBold, fontSize: fontSizes.hero, color: '#FFFFFF' },
  display: { fontFamily: fonts.displayBold, fontSize: fontSizes.display, color: '#FFFFFF' },
  headlineLarge: { fontFamily: fonts.displayBold, fontSize: fontSizes.headlineLarge, color: '#FFFFFF' },
  titleLarge: { fontFamily: fonts.semiBold, fontSize: fontSizes.titleLarge, color: '#FFFFFF' },
  titleMedium: { fontFamily: fonts.semiBold, fontSize: fontSizes.titleMedium, color: '#FFFFFF' },
  titleSmall: { fontFamily: fonts.semiBold, fontSize: fontSizes.titleSmall, color: '#FFFFFF' },
  bodyLarge: { fontFamily: fonts.regular, fontSize: fontSizes.bodyLarge, color: '#FFFFFF' },
  bodyMedium: { fontFamily: fonts.regular, fontSize: fontSizes.bodyMedium, color: '#FFFFFF' },
  bodySmall: { fontFamily: fonts.regular, fontSize: fontSizes.bodySmall, color: '#FFFFFF' },
  label: { fontFamily: fonts.medium, fontSize: fontSizes.label, color: '#FFFFFF' },
  caption: { fontFamily: fonts.regular, fontSize: fontSizes.caption, color: '#A0A0A0' },
  fareLarge: { fontFamily: fonts.monoBold, fontSize: fontSizes.fareLarge, color: '#FFFFFF' },
  fareMedium: { fontFamily: fonts.monoBold, fontSize: fontSizes.fareMedium, color: '#FFFFFF' },
  fareSmall: { fontFamily: fonts.monoBold, fontSize: fontSizes.fareSmall, color: '#FFFFFF' },
  fareInline: { fontFamily: fonts.monoRegular, fontSize: fontSizes.fareInline, color: '#FFFFFF' },
};

interface EyeGoTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
}

export function Text({ variant = 'bodyMedium', color, style, ...props }: EyeGoTextProps) {
  return (
    <RNText
      style={[variantStyles[variant], color ? { color } : undefined, style]}
      {...props}
    />
  );
}
```

### 6.6 Animated Pressable Primitive (packages/ui/src/primitives/Pressable.tsx)

All interactive elements use this for the press scale effect:

```tsx
import React from 'react';
import { Pressable as RNPressable, PressableProps, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

interface Props extends PressableProps {
  scaleTo?: number;
  style?: ViewStyle | ViewStyle[];
}

export function Pressable({ scaleTo = 0.97, style, children, ...props }: Props) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      style={[animatedStyle, style as ViewStyle]}
      onPressIn={() => {
        scale.value = withSpring(scaleTo, { stiffness: 300, damping: 20 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { stiffness: 300, damping: 20 });
      }}
      {...props}
    >
      {children}
    </AnimatedPressable>
  );
}
```

---

## 7. Navigation Architecture

### 7.1 Expo Router Overview

Expo Router uses file-based routing — like Next.js but for React Native. Every file in `app/` becomes a route. The folder/file name is the route path.

**Route groups** (folders with parentheses like `(auth)`) don't appear in the URL — they're just for organising layouts.

### 7.2 Rider App Navigation Map

```
app/
├── _layout.tsx         → Root layout — providers, font loading, auth gate
├── index.tsx           → Logic: check auth → redirect to (tabs)/home or (auth)/phone

├── (onboarding)/
│   ├── _layout.tsx     → No header, no tabs
│   └── index.tsx       → Full-screen onboarding slides

├── (auth)/
│   ├── _layout.tsx     → No header, no tabs, dark background
│   ├── phone.tsx       → Route: /phone
│   ├── otp.tsx         → Route: /otp (receives phone via params)
│   ├── register.tsx    → Route: /register
│   └── social.tsx      → Route: /social

├── (tabs)/
│   ├── _layout.tsx     → Bottom tab bar definition
│   ├── home.tsx        → Tab: Home (map)
│   ├── trips.tsx       → Tab: Trips
│   ├── notifications.tsx → Tab: Notifications
│   └── profile.tsx     → Tab: Profile

├── ride/
│   ├── select.tsx      → Route: /ride/select
│   ├── [id].tsx        → Route: /ride/123 (ride detail)
│   └── [id]/
│       ├── invite.tsx      → /ride/123/invite
│       ├── payment.tsx     → /ride/123/payment
│       ├── tracking.tsx    → /ride/123/tracking
│       └── complete.tsx    → /ride/123/complete

└── join/
    └── [token].tsx     → /join/abc123 (deep link handler)
```

### 7.3 Root Layout Auth Gate (apps/rider/app/_layout.tsx)

```tsx
import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useAuthStore } from '../stores/auth.store';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, hasSeenOnboarding } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === '(onboarding)';

    if (!hasSeenOnboarding && !inOnboarding) {
      router.replace('/(onboarding)');
    } else if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/phone');
    } else if (isAuthenticated && (inAuthGroup || inOnboarding)) {
      router.replace('/(tabs)/home');
    }
  }, [isAuthenticated, hasSeenOnboarding, segments]);

  return <>{children}</>;
}
```

### 7.4 Bottom Tab Navigator (apps/rider/app/(tabs)/_layout.tsx)

```tsx
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@eyego/config';
import { MapIcon, ClockIcon, BellIcon, UserIcon } from 'lucide-react-native';

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
          borderTopWidth: 1,
          height: 64 + insets.bottom,
          paddingBottom: insets.bottom,
        },
        tabBarActiveTintColor: colors.ecoGreen,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarShowLabel: false, // Icon only — clean look
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ tabBarIcon: ({ color, size }) => <MapIcon color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="trips"
        options={{ tabBarIcon: ({ color, size }) => <ClockIcon color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="notifications"
        options={{ tabBarIcon: ({ color, size }) => <BellIcon color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ tabBarIcon: ({ color, size }) => <UserIcon color={color} size={size} /> }}
      />
    </Tabs>
  );
}
```

---

## 8. State Management Architecture

### 8.1 Two-Layer State Model

**Layer 1: Zustand** — Client-only state that doesn't come from the server

| Store | File | What it holds |
|---|---|---|
| `authStore` | `stores/auth.store.ts` | tokens, user object, isAuthenticated |
| `uiStore` | `stores/ui.store.ts` | theme (dark/light), loading states |
| `socketStore` | `stores/socket.store.ts` | socket connection, connection status |
| `rideStore` | `stores/ride.store.ts` | active ride state, driver location |

**Layer 2: TanStack Query** — All server data (API calls, caching, refetching)

Use TanStack Query for: ride listings, booking details, payment status, trip history, notifications, driver profile.

**Rule:** Never use Zustand to store data that comes from the API. Use TanStack Query for that. Zustand is for auth state, UI state, and WebSocket-derived state only.

### 8.2 Auth Store (apps/rider/stores/auth.store.ts)

```typescript
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import type { User } from '@eyego/types';

// Zustand persist adapter for Expo SecureStore
const secureStorage = {
  getItem: async (name: string) => {
    return await SecureStore.getItemAsync(name);
  },
  setItem: async (name: string, value: string) => {
    await SecureStore.setItemAsync(name, value);
  },
  removeItem: async (name: string) => {
    await SecureStore.deleteItemAsync(name);
  },
};

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
  hasSeenOnboarding: boolean;

  setTokens: (access: string, refresh: string) => void;
  setUser: (user: User) => void;
  setHasSeenOnboarding: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      hasSeenOnboarding: false,

      setTokens: (access, refresh) =>
        set({ accessToken: access, refreshToken: refresh, isAuthenticated: true }),

      setUser: (user) => set({ user }),

      setHasSeenOnboarding: () => set({ hasSeenOnboarding: true }),

      logout: () =>
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: 'eyego-auth',
      storage: createJSONStorage(() => secureStorage),
    }
  )
);
```

### 8.3 Ride Store (for WebSocket-derived state)

```typescript
import { create } from 'zustand';

interface DriverLocation {
  lat: number;
  lng: number;
  bearing: number;
  speed: number;
}

interface RideState {
  activeRideId: string | null;
  driverLocation: DriverLocation | null;
  confirmedSeats: number;
  farePerSeat: number;
  rideStatus: string | null;

  setActiveRide: (rideId: string) => void;
  updateDriverLocation: (location: DriverLocation) => void;
  updateOccupancy: (seats: number, fare: number) => void;
  updateRideStatus: (status: string) => void;
  clearActiveRide: () => void;
}

export const useRideStore = create<RideState>((set) => ({
  activeRideId: null,
  driverLocation: null,
  confirmedSeats: 0,
  farePerSeat: 0,
  rideStatus: null,

  setActiveRide: (rideId) => set({ activeRideId: rideId }),
  updateDriverLocation: (location) => set({ driverLocation: location }),
  updateOccupancy: (seats, fare) => set({ confirmedSeats: seats, farePerSeat: fare }),
  updateRideStatus: (status) => set({ rideStatus: status }),
  clearActiveRide: () => set({
    activeRideId: null,
    driverLocation: null,
    confirmedSeats: 0,
    farePerSeat: 0,
    rideStatus: null,
  }),
}));
```

### 8.4 TanStack Query Setup

In both `apps/rider/app/_layout.tsx` and `apps/driver/app/_layout.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30 * 1000,       // 30 seconds
      gcTime: 5 * 60 * 1000,      // 5 minutes
    },
  },
});

// Wrap your root with:
<QueryClientProvider client={queryClient}>
  {/* rest of app */}
</QueryClientProvider>
```

---

## 9. API Client Setup

### 9.1 Axios Instance (packages/api/src/client.ts)

```typescript
import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/v1';

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// REQUEST INTERCEPTOR — attach access token
apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await SecureStore.getItemAsync('eyego-access-token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// RESPONSE INTERCEPTOR — handle 401, attempt token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = await SecureStore.getItemAsync('eyego-refresh-token');
        const response = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
        const { accessToken } = response.data.data;

        await SecureStore.setItemAsync('eyego-access-token', accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;

        return apiClient(originalRequest);
      } catch {
        // Refresh failed — clear tokens and redirect to login
        await SecureStore.deleteItemAsync('eyego-access-token');
        await SecureStore.deleteItemAsync('eyego-refresh-token');
        // Zustand logout will be called from the auth store listener
        throw error;
      }
    }

    return Promise.reject(error);
  }
);
```

### 9.2 Query Key Factory (packages/api/src/queryKeys.ts)

```typescript
// Use this factory for ALL TanStack Query keys — prevents key collisions
export const queryKeys = {
  rides: {
    all: ['rides'] as const,
    lists: () => [...queryKeys.rides.all, 'list'] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.rides.lists(), filters] as const,
    detail: (id: string) => [...queryKeys.rides.all, 'detail', id] as const,
    occupancy: (id: string) => [...queryKeys.rides.all, 'occupancy', id] as const,
  },
  bookings: {
    all: ['bookings'] as const,
    myHistory: () => [...queryKeys.bookings.all, 'my-history'] as const,
    detail: (id: string) => [...queryKeys.bookings.all, 'detail', id] as const,
  },
  routes: {
    all: ['routes'] as const,
    detail: (id: string) => [...queryKeys.routes.all, 'detail', id] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    list: () => [...queryKeys.notifications.all, 'list'] as const,
  },
  driver: {
    profile: ['driver', 'profile'] as const,
    wallet: ['driver', 'wallet'] as const,
    earnings: (period: string) => ['driver', 'earnings', period] as const,
  },
};
```

### 9.3 API Endpoint Functions (packages/api/src/endpoints/rides.api.ts)

```typescript
import { apiClient } from '../client';
import type { Ride, RideFilters, RideOccupancy } from '@eyego/types';
import type { ApiResponse } from '@eyego/types';

export const ridesApi = {
  getAvailable: (filters: RideFilters) =>
    apiClient.get<ApiResponse<Ride[]>>('/rides', { params: filters }),

  getById: (id: string) =>
    apiClient.get<ApiResponse<Ride>>(`/rides/${id}`),

  getByShareToken: (token: string) =>
    apiClient.get<ApiResponse<Ride>>(`/rides/join/${token}`),

  getOccupancy: (id: string) =>
    apiClient.get<ApiResponse<RideOccupancy>>(`/rides/${id}/occupancy`),

  create: (data: Partial<Ride>) =>
    apiClient.post<ApiResponse<Ride>>('/rides', data),

  updateStatus: (id: string, status: string) =>
    apiClient.patch<ApiResponse<Ride>>(`/rides/${id}/status`, { status }),

  getMyHistory: () =>
    apiClient.get<ApiResponse<Ride[]>>('/rides/my/history'),
};
```

---

## 10. WebSocket Client Setup

### 10.1 Socket Client (packages/api/src/socket.ts)

```typescript
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.EXPO_PUBLIC_API_URL?.replace('/v1', '')
  ?? 'http://localhost:3000';

let socket: Socket | null = null;

export function initSocket(accessToken: string): Socket {
  socket = io(SOCKET_URL, {
    transports: ['websocket'],
    extraHeaders: {
      Authorization: `Bearer ${accessToken}`,
    },
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function joinRideRoom(rideId: string): void {
  socket?.emit('join:ride', { rideId });
}

export function leaveRideRoom(rideId: string): void {
  socket?.emit('leave:ride', { rideId });
}

// Driver only
export function emitLocationUpdate(lat: number, lng: number, bearing: number): void {
  socket?.emit('driver:location_update', { lat, lng, bearing });
}
```

### 10.2 Socket Hook (apps/rider/hooks/useRideSocket.ts)

```typescript
import { useEffect } from 'react';
import { getSocket, joinRideRoom, leaveRideRoom } from '@eyego/api';
import { useRideStore } from '../stores/ride.store';

export function useRideSocket(rideId: string) {
  const { updateDriverLocation, updateOccupancy, updateRideStatus } = useRideStore();

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !rideId) return;

    joinRideRoom(rideId);

    socket.on('driver:location', (data) => {
      updateDriverLocation({
        lat: data.lat,
        lng: data.lng,
        bearing: data.bearing,
        speed: data.speed,
      });
    });

    socket.on('ride:occupancy_updated', (data) => {
      updateOccupancy(data.confirmedSeats, data.farePerSeat);
    });

    socket.on('ride:status_changed', (data) => {
      updateRideStatus(data.status);
    });

    return () => {
      leaveRideRoom(rideId);
      socket.off('driver:location');
      socket.off('ride:occupancy_updated');
      socket.off('ride:status_changed');
    };
  }, [rideId]);
}
```

---

## 11. Authentication Implementation

### 11.1 Phone OTP Flow

**Screen: apps/rider/app/(auth)/phone.tsx**

Key behaviour:
- Country code pre-selected to 🇬🇭 +233
- Button disabled until exactly 9 digits entered (strip leading zero)
- On submit: calls `POST /auth/send-otp`, navigates to OTP screen passing phone as param

```tsx
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@eyego/api';

export default function PhoneScreen() {
  const [phone, setPhone] = useState('');
  const router = useRouter();

  const sendOtpMutation = useMutation({
    mutationFn: (phoneNumber: string) =>
      authApi.sendOtp({ phone: phoneNumber, type: 'PHONE_VERIFY' }),
    onSuccess: () => {
      router.push({ pathname: '/(auth)/otp', params: { phone } });
    },
  });

  const formattedPhone = `+233${phone}`;
  const isValid = phone.length === 9;

  return (
    // Screen implementation
  );
}
```

**Screen: apps/rider/app/(auth)/otp.tsx**

Key behaviour:
- 6-box OTP input, auto-advance, auto-submit
- 60-second countdown, resend after countdown
- Shake animation on wrong code
- On success: if `needsProfile === true` → navigate to `/register`, else → navigate to `/(tabs)/home`

### 11.2 Google Sign-In

```tsx
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@eyego/api';
import { useAuthStore } from '../stores/auth.store';

// Configure once in _layout.tsx:
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});

// In component:
const googleSignInMutation = useMutation({
  mutationFn: async () => {
    await GoogleSignin.hasPlayServices();
    const userInfo = await GoogleSignin.signIn();
    const idToken = userInfo.data?.idToken;
    return authApi.loginGoogle({ idToken });
  },
  onSuccess: ({ data }) => {
    useAuthStore.getState().setTokens(data.data.accessToken, data.data.refreshToken);
    useAuthStore.getState().setUser(data.data.user);
  },
});
```

### 11.3 Apple Sign-In (iOS Only)

```tsx
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

// Only render Apple button on iOS:
{Platform.OS === 'ios' && (
  <AppleAuthentication.AppleAuthenticationButton
    buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
    cornerRadius={14}
    style={{ width: '100%', height: 56 }}
    onPress={async () => {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      // Send credential.identityToken to backend
      await authApi.loginApple({ identityToken: credential.identityToken });
    }}
  />
)}
```

---

## 12. Animation System

### 12.1 Core Principle

Use `moti` for declarative animations (most cases) and `react-native-reanimated` directly for gesture-driven or WebSocket-driven animations (van movement, fare counter). Never use React Native's built-in `Animated` API — it runs on the JS thread and will drop frames.

### 12.2 Moti Patterns

```tsx
import { MotiView, MotiText } from 'moti';

// Fade + scale in on mount (for cards, screens)
<MotiView
  from={{ opacity: 0, scale: 0.95 }}
  animate={{ opacity: 1, scale: 1 }}
  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
/>

// Staggered list items
{items.map((item, index) => (
  <MotiView
    key={item.id}
    from={{ opacity: 0, translateY: 20 }}
    animate={{ opacity: 1, translateY: 0 }}
    transition={{ delay: index * 80, type: 'spring' }}
  />
))}

// Pulsing animation (for "Live" badge, user location ring)
<MotiView
  from={{ scale: 1, opacity: 0.7 }}
  animate={{ scale: 1.4, opacity: 0 }}
  transition={{ loop: true, type: 'timing', duration: 1500 }}
  style={/* pulse ring style */}
/>
```

### 12.3 Animated Fare Counter (packages/ui/src/components/AnimatedFareText.tsx)

This is critical — when fare drops as more people join, the number must animate:

```tsx
import { useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { TextInput } from 'react-native';
import { fonts, fontSizes } from '@eyego/config';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

interface AnimatedFareTextProps {
  value: number;
  prefix?: string;
}

export function AnimatedFareText({ value, prefix = 'GHS ' }: AnimatedFareTextProps) {
  const animatedValue = useSharedValue(value);

  useEffect(() => {
    animatedValue.value = withTiming(value, {
      duration: 600,
      easing: Easing.out(Easing.cubic),
    });
  }, [value]);

  const animatedProps = useAnimatedProps(() => ({
    text: `${prefix}${animatedValue.value.toFixed(2)}`,
    defaultValue: `${prefix}${value.toFixed(2)}`,
  }));

  return (
    <AnimatedTextInput
      animatedProps={animatedProps}
      editable={false}
      style={{
        fontFamily: fonts.monoBold,
        fontSize: fontSizes.fareLarge,
        color: '#FFFFFF',
      }}
    />
  );
}
```

### 12.4 Van Marker Smooth Movement

The van on the tracking map must not snap to new coordinates — it must glide:

```tsx
import { useEffect, useRef } from 'react';
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
  interpolate,
} from 'react-native-reanimated';
import { useRideStore } from '../stores/ride.store';

export function useAnimatedVanPosition() {
  const { driverLocation } = useRideStore();
  const lat = useSharedValue(driverLocation?.lat ?? 0);
  const lng = useSharedValue(driverLocation?.lng ?? 0);
  const bearing = useSharedValue(driverLocation?.bearing ?? 0);

  useEffect(() => {
    if (!driverLocation) return;
    lat.value = withTiming(driverLocation.lat, { duration: 3000 });
    lng.value = withTiming(driverLocation.lng, { duration: 3000 });
    bearing.value = withTiming(driverLocation.bearing, { duration: 1000 });
  }, [driverLocation]);

  return { lat, lng, bearing };
}
```

### 12.5 OTP Shake on Error

```tsx
import { useSharedValue, withSequence, withTiming, useAnimatedStyle } from 'react-native-reanimated';

const shakeOffset = useSharedValue(0);

const animatedStyle = useAnimatedStyle(() => ({
  transform: [{ translateX: shakeOffset.value }],
}));

function triggerShake() {
  shakeOffset.value = withSequence(
    withTiming(-8, { duration: 60 }),
    withTiming(8, { duration: 60 }),
    withTiming(-6, { duration: 60 }),
    withTiming(6, { duration: 60 }),
    withTiming(0, { duration: 60 }),
  );
}
```

### 12.6 Screen Transition Config

In `app/_layout.tsx` for both apps, configure custom transitions:

```tsx
import { Stack } from 'expo-router';
import { TransitionPresets } from '@react-navigation/stack';

<Stack
  screenOptions={{
    headerShown: false,
    animation: 'slide_from_right',   // Default for page pushes
    gestureEnabled: true,            // Swipe back enabled
  }}
>
  <Stack.Screen
    name="(tabs)"
    options={{ animation: 'fade' }}   // Fade for tab root
  />
</Stack>
```

Bottom sheets use `@gorhom/bottom-sheet` which has its own spring physics — do not animate them manually.

---

## 13. Rider App — Screen Specifications

> Every screen listed here is a file in `apps/rider/app/`. Build them in this exact order.

### 13.1 Splash Screen (handled by expo-splash-screen)

Do not build a "splash screen" as a route. Use `expo-splash-screen` to hold the native splash while fonts load, then hide it. The native splash image (`splash.png`) should show the EyeGo wordmark on `#0A0A0A`.

After fonts load and auth state resolves, the root `index.tsx` redirects appropriately. This is the correct Expo pattern.

### 13.2 Onboarding (apps/rider/app/(onboarding)/index.tsx)

**State:** Local component state only — no store needed except `setHasSeenOnboarding()` on completion.

```
Layout:
- StatusBar: dark-content (light icons on dark background)
- Full screen, no safe area padding on the top — illustration bleeds to top
- Bottom panel: Surface card with rounded top corners 28px, holds dots + text + buttons
- 3 slides controlled by a FlatList with pagingEnabled

Slide data:
  [
    {
      id: 1,
      headline: "Skip the Queue",
      body: "Book your seat before you leave home. Your van waits for you.",
      illustrationBg: ecoGreenSubtle,
    },
    {
      id: 2,
      headline: "Split the Fare",
      body: "The more people ride, the less everyone pays. Share a link. Save together.",
      illustrationBg: comfortBlueSubtle,
    },
    {
      id: 3,
      headline: "Track Every Move",
      body: "Know exactly when your driver arrives. No waiting. No guessing.",
      illustrationBg: ecoGreenSubtle,
    },
  ]

Dot indicator:
  Active dot: Eco Green, width 24px, height 8px, borderRadius 4px (pill)
  Inactive dot: #3A3A3A, width 8px, height 8px, borderRadius 4px

Buttons:
  Last slide: "Let's Go" Primary Eco button
  Other slides: "Next →" Primary Eco button
  Above button on all slides: "Skip" ghost text in textTertiary

On "Let's Go": useAuthStore.getState().setHasSeenOnboarding() → router.replace('/(auth)/phone')
```

### 13.3 Auth — Phone Screen (apps/rider/app/(auth)/phone.tsx)

```
Layout:
  - Background: background (#0A0A0A)
  - Safe area top padding
  - Logo wordmark: "EyeGo" in Clash Display Bold 20px, left-aligned, paddingTop 16
  - Headline: "What's your number?" Clash Display Bold 32px, marginTop 48
  - Subtext: "We'll send you a verification code." Satoshi Regular 16px textSecondary, marginTop 8

Phone input:
  - Custom component: left section (flag + code), right section (number)
  - Left: "🇬🇭 +233" — Satoshi Medium 15px White, 60px wide, right border 1px divider
  - Right: TextInput, keyboardType="numeric", maxLength=9
  - Container: height 56px, backgroundColor surfaceElevated, borderRadius 14px
  - On focus: 1.5px border eco-green + subtle inner glow

"Send Code" button: Primary Eco, disabled until phone.length === 9

Social auth divider: View with flex row — line / text / line

Social buttons:
  - Google: Surface Elevated background, Google G icon SVG, "Google" Satoshi Medium 15px
  - Apple: Platform.OS === 'ios' only, white background, Apple icon, black text

"Use email instead": ghost text link, marginTop 16, textSecondary
```

### 13.4 Auth — OTP Screen (apps/rider/app/(auth)/otp.tsx)

```
Receives: { phone } via useLocalSearchParams()

Layout:
  - Back arrow IconButton top left
  - Headline: "Enter the code" Clash Display Bold 32px
  - Subtext: "Sent to [phone]" — phone number highlighted in ecoGreen

OTP Input:
  - 6 individual TextInput components in a Row, each 48x56px
  - Background: surfaceElevated, borderRadius 12px
  - Gaps: 8px between boxes
  - Font: JetBrains Mono Bold 24px, textAlign center
  - Active box: eco-green 1.5px border
  - Auto-focus next box on input
  - Auto-submit when 6th digit entered
  - backspace: clear current box, focus previous
  - Shake animation on wrong code (see section 12.5)

Countdown:
  - useEffect with setInterval, decrement from 60
  - Display: JetBrains Mono Regular 16px textTertiary
  - "Resend code" text: disabled grey until 0, then ecoGreen active

On success:
  - if data.needsProfile: router.push('/(auth)/register')
  - else: router.replace('/(tabs)/home')
```

### 13.5 Auth — Register Screen (apps/rider/app/(auth)/register.tsx)

```
Layout:
  - Back arrow
  - Headline: "Almost there" Clash Display Bold 32px
  - Subtext: Satoshi Regular 16px textSecondary

Avatar section:
  - 80px circle, surfaceElevated, person icon centered
  - Bottom-right: 24px circle, ecoGreen background, "+" icon
  - Tappable: opens expo-image-picker
  - "Add photo (optional)" caption below, centred

Inputs:
  - Full name (required, autoFocus)
  - Email (optional, label: "Email (optional)", keyboardType email)

Submit button: "Create My Account" Primary Eco
  - Disabled until name.length > 1
  - Loading state while mutation runs
```

### 13.6 Home Screen — Map (apps/rider/app/(tabs)/home.tsx)

**This is the most important screen. Every detail matters.**

```
Structure (bottom to top layering):
  Layer 0 (base): MapboxGL.MapView — full screen, dark-v11 style
  Layer 1: Van markers on map (animated position)
  Layer 2: User location marker (pulse animation)
  Layer 3: Top bar (floating, no bg)
  Layer 4: Bottom panel (BottomSheet, backdrop blur)
  Layer 5: Bottom tab bar

Top bar (absolute position, top of screen):
  - paddingTop: safe area inset + 8
  - paddingHorizontal: 20
  - flexDirection: row, justifyContent: space-between, alignItems: center
  - Left: "EyeGo" wordmark small (Clash Display Bold 20px white) + "Good morning, [name]" below (Satoshi Medium 14px textSecondary)
  - Right: Bell IconButton (surfaceElevated circular 44px) with notification count badge (ecoGreen 18px circle, white text 11px)

Bottom panel (BottomSheet from @gorhom/bottom-sheet):
  snapPoints: ['45%', '70%']  ← collapses to 45%, expands to 70%
  backgroundStyle: { backgroundColor: mapOverlay (#0A0A0A 78% opacity), backdropFilter: blur(20px) }
  handleIndicatorStyle: { backgroundColor: '#3A3A3A', width: 40, height: 4 }

  Inside panel (paddingHorizontal 20):

  1. Route search bar (Pressable, NOT a real input — taps navigate to /ride/select):
    Height 56px, surfaceElevated bg, borderRadius 14px
    Left: green dot icon, Right: arrow icon, Centre: "Where are you going?" textTertiary

  2. "Available Now" + Live badge:
    Row: "Available Now" titleSmall + animated green dot badge

  3. Horizontal scrollable ride cards:
    FlashList horizontal, showsHorizontalScrollIndicator false
    ItemSeparatorComponent: 12px gap
    Eco card: show 1 card + peek of next (to indicate scrollability)

  4. Action buttons row:
    "Book a Ride" Primary Eco (flex 1)
    "My Trips" Secondary Outlined (flex 1)
    8px gap between

Data:
  useQuery(queryKeys.rides.list({ tier: 'ECO', routeId: ... }), ridesApi.getAvailable)
  WebSocket: subscribe to 'driver:location' events, update van markers
```

### 13.7 Ride Selection (apps/rider/app/ride/select.tsx)

```
Rendered as full screen with map behind (same mapbox setup as home, less interactive)
BottomSheet snapPoints: ['65%'] — fixed, not collapsible

Inside sheet:
  Header row: "Plan Your Ride" titleLarge + Close X icon button

  Route selectors (stacked, connected by dotted line on left):
    FROM card: surfaceElevated, 📍 green dot, dropdown
    TO card: surfaceElevated, 📍 white outline dot, dropdown
    Vertical dotted connector line between the two dots (absolute positioned)

  When route selected: populate from available routes via useQuery(queryKeys.routes.all)

  Tier selector: Two TierSelector cards side by side (from @eyego/ui)
    Eco: default selected
    Comfort: unselected
    Tapping switches selection with spring scale animation

  Departure row: "Leave Now" (selected, ecoGreen bg) + "Schedule" (surfaceElevated) pills

  Heavy Load toggle:
    Row with text + Toggle switch
    When toggled on: MotiView animates in a warning banner below

  "Find Rides" Primary Eco button:
    On press: router.push({
      pathname: '/ride/[id]',   ← Actually goes to ride list, pick first result
      params: { routeId, tier, departureType }
    })
```

### 13.8 Ride Detail (apps/rider/app/ride/[id].tsx)

```
Map background: full bleed, shows route line from origin to destination

BottomSheet: snapPoints: ['60%', '85%']

Inside sheet:
  Route + tier + time header row
  Driver info card (@eyego/ui DriverInfoCard)
  Divider
  Seat count bar (@eyego/ui SeatBar) — live updating via useRideSocket
  Fare section:
    AnimatedFareText component (fareLarge variant, updates on WebSocket)
    "per seat · drops as more join" caption
  Stop selector: surfaceElevated card, chevron dropdown
  Booking options (3 rows):
    "Book for myself"
    "Book & invite my group"
    "I'm paying for everyone" (ecoGreen text + ecoGreenSubtle bg)

  Primary button: "Book This Seat — GHS [fare]"
    Uses AnimatedFareText inline in button label
    On press: calls bookingApi.create → on success navigate to /ride/[id]/invite or /payment

WebSocket: useRideSocket(rideId) hook active on this screen
Poll fallback: useQuery refetchInterval 30000 for occupancy
```

### 13.9 Invite Group (apps/rider/app/ride/[id]/invite.tsx)

```
Full-screen BottomSheet (snapPoints: ['90%'])
No map visible behind this one — use background colour

Heading + close X

Share link card:
  surfaceElevated, borderRadius 14px
  Left: "eyego.app/join/[token]" ecoGreen Satoshi Medium 14px
  Right: "Copy" pill (tap: Clipboard.setStringAsync → show toast "Copied!")

Share platform buttons row:
  WhatsApp, Telegram, SMS
  Use expo-sharing or Linking.openURL with deep link

"Who's Joined" section:
  FlashList of booking roster
  Row per booking: status icon + name + payment status + fare
  Animate new rows in with MotiView stagger when new payment confirmed via WebSocket

"Add someone without a phone" row:
  ecoGreen text, phone-x icon
  Navigates to driver's offline flow (or shows modal explaining it)

Live fare display:
  surfaceElevated pill at bottom
  AnimatedFareText + "drops when more join" caption
```

### 13.10 Payment Screen (apps/rider/app/ride/[id]/payment.tsx)

```
BottomSheet snapPoints: ['70%']

Summary card: surfaceElevated
  Route, fare (fareLarge AnimatedFareText), breakdown caption

Payment method section:
  "Mobile Money" section header

  Network chips row (horizontal):
    MTN (yellow bg), Telecel (red bg), AirtelTigo (blue bg)
    Selectable — only one active at a time
    Active: solid colour bg + white text
    Inactive: subtle bg + coloured text

  Phone input (MotiView animates in when network selected):
    from={{ opacity: 0, translateY: -10 }}
    animate={{ opacity: 1, translateY: 0 }}
    transition={{ type: 'spring' }}

  Divider "or"

  Card option row: surfaceElevated card, Visa + Mastercard logos, arrow

  "Secured by Paystack" caption + lock icon, centred

Primary button: "Pay GHS [amount]"
  On press:
    1. Calls paymentsApi.initiate({ bookingId, method, momoPhone })
    2. For MoMo: poll paymentsApi.getStatus every 3s for 5 minutes
    3. For Card: open Paystack WebView (use react-native-webview)
    4. On success: navigate to tracking screen
    5. Listen for WebSocket 'payment:success' as primary confirmation

Loading state: button shows 3-dot loader, disable all inputs
```

### 13.11 Live Tracking (apps/rider/app/ride/[id]/tracking.tsx)

```
Full bleed map — most visual, most important

Map elements:
  - Route line: ecoGreen, 3px, from current driver position to destination
  - Van marker: custom SVG, animates position (useAnimatedVanPosition hook)
  - User pickup pin: white circle, green dot
  - Destination pin: custom SVG

Top bar (floating over map):
  Back arrow IconButton (surfaceElevated)
  "En route to you" OR "Heading to Madina" Satoshi SemiBold 16px White
  Share IconButton

ETA pill (floating, mid-map bottom-left quadrant):
  Surface card, borderRadius 100px, backdropBlur
  "3 min away" Satoshi SemiBold 16px ecoGreen + clock icon
  Shadow: 0px 4px 16px ecoGreenSubtle

Bottom panel (BottomSheet, snapPoints: ['40%'], non-draggable):
  Driver row + Call Driver button
  Divider
  Stats row: ABOARD [number ecoGreen] | PENDING [number warning]
  Progress bar: 4px height, full width, ecoGreen fill, borderRadius 2px
  Stop labels below bar

WebSocket: useRideSocket active — driver location updates every 5s
On ride:status_changed to COMPLETED: wait 3s → router.replace('/ride/[id]/complete')
```

### 13.12 Post-Ride Rating (apps/rider/app/ride/[id]/complete.tsx)

```
Dark background, centred layout, no map
Only accessible when ride.status === COMPLETED

Top: compact trip summary card (route, fare paid, "Completed" badge)

Large spacing (48px)

"How was your ride?" Clash Display Bold 28px centred
"With [driver name]" Satoshi Regular 16px textSecondary centred
Driver avatar 64px, 2px ecoGreen border

Stars row:
  5 star icons, 48px each, 8px gaps
  Empty: outline, textTertiary
  Filled: ecoGreen, spring pop animation on each tap
  useMutation onSuccess: show toast "Thanks for rating!"

Comment input (optional): surfaceElevated, 56px

Submit + Skip buttons
```

---

## 14. Driver App — Screen Specifications

> Files in `apps/driver/app/`. Same design system, Driver Orange as primary.

### 14.1 Driver Home (apps/driver/app/(tabs)/home.tsx)

```
Background: #0A0A0A (no map — driver home is operational)
StatusBar: dark-content

Greeting: "Good morning, [name] 👋" Clash Display Bold 24px
Subtext: "[Day], [Date] · Accra" Satoshi Regular 14px textSecondary

Online Toggle Card (MOST IMPORTANT — make it visually dominant):
  Surface card, borderRadius 20px, padding 20px
  Toggle: 80x44px, custom wider toggle
    OFF state: #2A2A2A track, white knob
    ON state: driverOrange track, white knob
    Knob animates with spring physics on toggle
  Label: "OFFLINE" / "ONLINE" JetBrains Mono Bold 18px, updates with toggle
  Subtext below label
  When ONLINE: card gets driverOrangeSubtle tint

On toggle ON:
  1. PATCH /drivers/me/online { isOnline: true }
  2. Start location broadcasting (expo-location background task)
  3. Socket connect + join driver room

Wallet card (driverOrange 4px left accent bar):
  Balance in JetBrains Mono Bold 28px
  If balance < 5 GHS: show warning chip + "Top Up" button

Assigned Ride card:
  Route, time (ecoGreen JetBrains Mono Bold 18px), vehicle
  Seat count bar (compact)
  "Start Route" Primary Driver Orange button
    disabled until confirmedSeats >= minOccupancyToStart
    disabled subtext: "5 passengers required to start" warning yellow caption
```

### 14.2 Active Ride (apps/driver/app/ride/[id].tsx)

```
Full bleed Mapbox map
Route line ecoGreen
Driver's own van marker (driverOrange outline)
Next stop: pulsing driverOrange ring

Top bar: "RIDE IN PROGRESS" badge (driverOrange bg) + timer

Next Stop card (floating, top-left):
  Surface card, backdropBlur
  Stop name, passengers expected (warning yellow)
  "I've Arrived" outlined driverOrange button

Bottom panel:
  Seat counts row: ONBOARD | PENDING
  Two action buttons:
    "View Passengers" → navigate to /ride/[id]/manifest
    "+ Cash Passenger" → navigate to /ride/[id]/add-passenger
  "End Trip" Destructive full width button
    On press: show confirmation modal → PATCH /rides/[id]/status COMPLETED
```

### 14.3 Passenger Manifest (apps/driver/app/ride/[id]/manifest.tsx)

```
Standard screen, no map
Header: "Passengers ([boarded]/[total])" + back arrow

FlashList of booking rows (estimatedItemSize: 72):
  Each row 72px, 1px Divider separator

  BOARDED row (success green accent):
    Left: seat number chip (successSubtle bg, success text, JetBrains Mono Bold 14px)
    Middle: name (Satoshi SemiBold 15px) + "Paid · GHS X.XX" (success green)
    Right: "✓ Boarded" chip OR "Confirm Boarded" driverOrange text button
    On "Confirm Boarded": PATCH /bookings/[id]/board → row animates to boarded state

  CASH/OTP row (warning yellow accent):
    Left: seat chip (warningSubtle bg, warning text)
    Middle: "[name] (Cash)" + "OTP Required" warning yellow
    Right: 4-box OTP input (36x44px each) + "Verify" driverOrange pill
    On "Verify":
      POST /bookings/[id]/verify-offline { otp }
      Success: row animates to boarded state + wallet deduction confirmation toast
      Error: shake animation on OTP boxes

  PENDING row:
    Left: seat chip (surfaceElevated, no colour)
    Middle: name + "Awaiting payment" italic textSecondary
    Right: clock icon, warningSubtle

  EMPTY row:
    Middle: "Empty seat" textTertiary
    Right: "+ Add" driverOrange text button → navigate to add-passenger

Header summary bar:
  Row at top: "X boarded · Y pending · Z empty"
  Refresh on socket 'payment:success' event
```

### 14.4 Add Cash Passenger (apps/driver/app/ride/[id]/add-passenger.tsx)

```
BottomSheet snapPoints: ['60%']

Info banner (driverOrangeSubtle, left border 4px driverOrange):
  "This passenger pays you cash. Commission is auto-deducted from your wallet."

Phone input: full width, keyboardType phone-pad

Fare display card: surfaceElevated
  "GHS [farePerSeat]" fareLarge JetBrains Mono Bold
  "Based on [n] current passengers" caption

Heavy Load toggle row

Commission note: "Commission (15%) = GHS [amount] will be deducted" caption textTertiary

"Send OTP & Assign Seat" Primary Driver Orange:
  On press:
    POST /bookings/add-offline { rideId, offlinePhone, loadType, stopId }
    Success: toast "OTP sent to [phone]" + navigate back to manifest
    Error: toast with error message
```

### 14.5 Earnings Screen (apps/driver/app/(tabs)/earnings.tsx)

```
Standard screen
Header: "Earnings" titleLarge

Period pills: "Today" (active driverOrange) | "This Week" | "This Month"
  useQuery refetches when period changes

Hero card (subtle gradient, driverOrange corner accent):
  Amount: Clash Display Bold 40px
  Period label
  Stats row: Trips | KM | Rating (JetBrains Mono Bold 18px each)

Bar chart:
  Use react-native-svg to draw bars
  7 bars for the week (or 30 for month)
  driverOrange fill, height proportional to earnings
  Labels below: day abbreviations in caption textTertiary

Transaction FlashList:
  Completed trips: route + time + amount (ecoGreen JetBrains Mono)
  Commission deductions: "Commission" + amount (driverOrange)

"Withdraw Earnings" Primary Driver Orange fixed at bottom
```

---

## 15. Shared Components Library

All components in `packages/ui/src/components/`. Each exported from `packages/ui/src/index.ts`.

### 15.1 Button (Button.tsx)

```tsx
type ButtonVariant = 'eco' | 'comfort' | 'driver' | 'secondary' | 'ghost' | 'destructive';
type ButtonSize = 'lg' | 'md' | 'sm';

Props:
  variant: ButtonVariant
  size?: ButtonSize (default 'lg')
  label: string
  onPress: () => void
  disabled?: boolean
  loading?: boolean
  fullWidth?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode

Heights:
  lg: 56px (primary actions)
  md: 48px (secondary actions)
  sm: 36px (inline actions, pills)

Background colours by variant:
  eco: ecoGreen → ecoGreenDim on press
  comfort: comfortBlue → comfortBlueDim on press
  driver: driverOrange → driverOrangeDim on press
  secondary: transparent, border 1.5px tier colour
  ghost: transparent, no border
  destructive: error (#FF3B30)

Shadow by variant (eco/comfort/driver only):
  Apply coloured shadow using React Native shadow props

Loading state: replace label with 3 dot indicator (MotiView pulsing opacity)
Disabled state: background #2A2A2A, text textTertiary, no shadow

Wrap in Pressable primitive for scale animation
```

### 15.2 Input (Input.tsx)

```tsx
Props:
  label: string
  value: string
  onChangeText: (text: string) => void
  error?: string
  secureTextEntry?: boolean
  keyboardType?: KeyboardTypeOptions
  autoFocus?: boolean
  rightAccessory?: React.ReactNode
  leftAccessory?: React.ReactNode

Implementation:
  Floating label animation:
    useSharedValue for label position (translateY)
    On focus + on value: animate label up (Satoshi Medium 12px, textSecondary)
    At rest with no value: Satoshi Regular 16px, textTertiary, centered vertically

  Border animation:
    useSharedValue for border colour + opacity
    On focus: withTiming to tier colour
    On blur: withTiming to transparent

  Error state:
    Red border
    Error message text below input (Satoshi Regular 12px, error colour)
    MotiView for error text slide-down animation
```

### 15.3 OTP Input (OTPInput.tsx)

```tsx
Props:
  length?: number (default 6)
  onComplete: (code: string) => void
  hasError?: boolean

Internal:
  Array of refs (one per box)
  Single hidden TextInput for receiving input (opacity 0, position absolute)
  Visible boxes are styled Views showing the character
  Auto-advance on input, backspace to previous
  Shake animation exposed via ref (imperative handle)

Box styling:
  48x56px, surfaceElevated, borderRadius 12px
  Active: ecoGreen 1.5px border
  Filled: textPrimary, JetBrains Mono Bold 24px
  Error: error red border (all boxes)
```

### 15.4 Ride Card (RideCard.tsx)

```tsx
Props:
  ride: Ride  (type from @eyego/types)
  onPress: () => void

Layout:
  Surface card, borderRadius 16px, border 1px divider, padding 16px

  Row 1: Route name (titleSmall) + TierBadge + time (fareInline textSecondary)
  Row 2: Driver info mini (avatar 32px + name + rating)
  Row 3: Seat count bar (compact, 8 circles) + "X left" label
  Row 4: Fare amount (fareMedium ecoGreen/comfortBlue) + "per seat" caption

Animate in with MotiView from={{ opacity: 0, scale: 0.97 }}
```

### 15.5 Seat Bar (SeatBar.tsx)

```tsx
Props:
  total: number        (vehicle capacity)
  confirmed: number    (paid + boarded)
  pending: number      (payment initiated)
  compact?: boolean    (smaller circles for cards)

Circle sizes:
  Default: 20px diameter, 6px gap
  Compact: 12px diameter, 4px gap

Colours:
  Filled (confirmed): ecoGreen
  Pending: warning (#FFB800)
  Empty: surfaceElevated, 1px dashed divider border

When confirmed count changes: animate the newly filled circle with scale pop
```

### 15.6 Bottom Sheet Wrapper (BottomSheet.tsx)

```tsx
Re-exports @gorhom/bottom-sheet with EyeGo styling defaults applied:

import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

Default props:
  backgroundStyle: { backgroundColor: colors.surface }
  handleIndicatorStyle: { backgroundColor: '#3A3A3A', width: 40, height: 4 }
  enablePanDownToClose: true
  backdropComponent: BottomSheetBackdrop (from @gorhom/bottom-sheet)

Map overlay variant (for sheets over map):
  backgroundStyle: { backgroundColor: colors.mapOverlay }
  Use BlurView from expo-blur for backdrop blur effect
```

### 15.7 Skeleton (Skeleton.tsx)

```tsx
Uses MotiView for shimmer animation:

<MotiView
  from={{ opacity: 0.4 }}
  animate={{ opacity: 1 }}
  transition={{
    loop: true,
    type: 'timing',
    duration: 800,
    repeatReverse: true,
  }}
  style={[
    { backgroundColor: colors.surfaceElevated, borderRadius },
    style
  ]}
/>

Usage pattern:
  isLoading ? <Skeleton width={200} height={20} borderRadius={10} /> : <ActualContent />
```

---

## 16. Maps Implementation

### 16.1 Mapbox Setup

```bash
# Install
yarn workspace @eyego/rider add @rnmapbox/maps
yarn workspace @eyego/driver add @rnmapbox/maps
```

```typescript
// In app/_layout.tsx for both apps:
import Mapbox from '@rnmapbox/maps';
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN!);
```

### 16.2 app.config.ts (Both Apps)

```typescript
// Mapbox requires native config via app.config.ts plugin:
export default {
  plugins: [
    [
      '@rnmapbox/maps',
      {
        RNMapboxMapsDownloadToken: process.env.MAPBOX_DOWNLOAD_TOKEN,
      },
    ],
  ],
};
```

### 16.3 Map Component Usage

```tsx
import Mapbox, {
  MapView,
  Camera,
  UserLocation,
  ShapeSource,
  LineLayer,
  PointAnnotation,
} from '@rnmapbox/maps';

export function RideMap({ driverLat, driverLng, destLat, destLng }: MapProps) {
  return (
    <MapView
      style={{ flex: 1 }}
      styleURL="mapbox://styles/mapbox/dark-v11"
      logoEnabled={false}
      attributionEnabled={false}
      compassEnabled={false}
    >
      <Camera
        centerCoordinate={[driverLng, driverLat]}
        zoomLevel={13}
        animationMode="flyTo"
        animationDuration={1000}
      />

      <UserLocation
        visible={true}
        renderMode="native"
      />

      {/* Route line */}
      <ShapeSource
        id="routeSource"
        shape={{
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [[originLng, originLat], [destLng, destLat]],
          },
        }}
      >
        <LineLayer
          id="routeLine"
          style={{
            lineColor: colors.ecoGreen,
            lineWidth: 3,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </ShapeSource>

      {/* Van marker — uses custom SVG */}
      <PointAnnotation id="van" coordinate={[driverLng, driverLat]}>
        <VanMarkerSVG tier="ECO" />
      </PointAnnotation>
    </MapView>
  );
}
```

### 16.4 Driver GPS Broadcasting (Driver App)

```typescript
// apps/driver/tasks/locationTask.ts
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { emitLocationUpdate } from '@eyego/api';

const LOCATION_TASK_NAME = 'eyego-driver-location';

TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => {
  if (error) { console.error(error); return; }
  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    const location = locations[0];
    emitLocationUpdate(
      location.coords.latitude,
      location.coords.longitude,
      location.coords.heading ?? 0,
    );
  }
});

// Start broadcasting when driver goes online:
export async function startLocationBroadcast() {
  const { status } = await Location.requestBackgroundPermissionsAsync();
  if (status !== 'granted') return;

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: 5000,       // Every 5 seconds
    distanceInterval: 10,     // Or every 10 meters
    foregroundService: {
      notificationTitle: 'EyeGo Driver',
      notificationBody: 'Broadcasting your location to passengers',
    },
  });
}

export async function stopLocationBroadcast() {
  await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
}
```

---

## 17. Payment Implementation

### 17.1 Paystack Integration Strategy

There is no official Paystack React Native SDK that is stable with Expo SDK 51. Use a WebView approach for card payments and a polling approach for MoMo.

### 17.2 MoMo Payment Flow

```typescript
// In payment screen:
const initiatePaymentMutation = useMutation({
  mutationFn: async ({ bookingId, momoPhone, network }: PaymentPayload) => {
    // 1. Backend initiates Paystack charge, returns reference
    const response = await paymentsApi.initiate({
      bookingId,
      method: network,         // 'MOMO_MTN' | 'MOMO_TELECEL' | 'MOMO_AIRTELTIGO'
      momoPhone,
    });
    return response.data.data; // { reference, status }
  },
  onSuccess: ({ reference }) => {
    // 2. Start polling for payment status
    startPolling(reference);
  },
});

function startPolling(reference: string) {
  const interval = setInterval(async () => {
    const status = await paymentsApi.getStatus(reference);
    if (status.data.data.status === 'SUCCESS') {
      clearInterval(interval);
      router.replace(`/ride/${rideId}/tracking`);
    }
    if (status.data.data.status === 'FAILED') {
      clearInterval(interval);
      showToast({ type: 'error', text: 'Payment failed. Please try again.' });
    }
  }, 3000); // Poll every 3 seconds

  // Stop polling after 5 minutes regardless
  setTimeout(() => clearInterval(interval), 5 * 60 * 1000);
}
```

### 17.3 Card Payment via WebView

```tsx
import { WebView } from 'react-native-webview';

// 1. Backend returns authorization_url from Paystack
// 2. Open in WebView
// 3. Intercept the callback URL to detect completion

<WebView
  source={{ uri: paystackAuthUrl }}
  onNavigationStateChange={(navState) => {
    // Paystack redirects to callback_url on completion
    if (navState.url.includes('/payments/webhook')) {
      // Payment completed — close WebView, poll for final status
      setWebViewVisible(false);
      startPolling(reference);
    }
  }}
/>
```

---

## 18. Push Notifications

### 18.1 Setup

```typescript
// In app/_layout.tsx after auth:
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function registerForPushNotifications() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  const token = await Notifications.getExpoPushTokenAsync({
    projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
  });

  // Send token to backend
  await usersApi.updateFcmToken({ fcmToken: token.data });
}
```

### 18.2 Deep Link Handling

```typescript
// When notification tapped:
Notifications.addNotificationResponseReceivedListener((response) => {
  const deepLink = response.notification.request.content.data?.deepLink as string;
  if (deepLink) {
    router.push(deepLink);  // e.g., '/ride/123/tracking'
  }
});
```

---

## 19. No-Mac iOS Workflow

Since you have no Mac, here is exactly how you test and build for iOS:

### 19.1 Testing on Physical iPhone (Primary Method)

```bash
# 1. Install Expo Go on your iPhone from the App Store

# 2. Start your app:
yarn rider   # Starts the Metro bundler

# 3. Scan the QR code in Expo Go
# Your app runs on your iPhone instantly — no build needed

# Limitation: Expo Go has some native module restrictions.
# @rnmapbox/maps CANNOT run in Expo Go — you need a development build.
```

### 19.2 Development Build for iPhone (Without Mac)

```bash
# 1. Install EAS CLI
npm install -g eas-cli

# 2. Login to Expo account
eas login

# 3. Configure EAS Build
eas build:configure

# 4. Build iOS development build in the cloud (runs on Expo's Mac servers)
eas build --platform ios --profile development

# This takes ~15-20 minutes and emails you a .ipa link
# Install on your iPhone via the Expo dashboard or direct .ipa install

# 5. After installing, your iPhone IS the iOS simulator
# Start Metro and the dev build connects automatically
```

### 19.3 eas.json

```json
{
  "cli": { "version": ">= 10.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": {
        "simulator": false,
        "buildConfiguration": "Debug"
      },
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleDebug"
      }
    },
    "preview": {
      "distribution": "internal",
      "ios": { "simulator": false },
      "android": { "buildType": "apk" }
    },
    "production": {
      "ios": { "buildConfiguration": "Release" },
      "android": { "buildType": "app-bundle" }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "your@email.com",
        "ascAppId": "YOUR_APP_STORE_CONNECT_APP_ID"
      },
      "android": {
        "serviceAccountKeyPath": "./google-play-key.json",
        "track": "production"
      }
    }
  }
}
```

### 19.4 Testing Priority

```
Priority 1: Android emulator (on your dev machine)
  → Fast iteration, no cloud builds needed
  → Test ALL features here first

Priority 2: Physical Android device
  → Scan QR in Expo Go for quick tests
  → Use dev build for Mapbox + background location

Priority 3: Physical iPhone (via EAS dev build)
  → Build in cloud, install once, use for iOS-specific testing
  → Check: iOS fonts, iOS navigation gestures, Apple Sign-In, iOS haptics

Priority 4: Production builds
  → Only when feature is complete and tested on priorities 1–3
```

---

## 20. EAS Build Configuration

### 20.1 App Config (apps/rider/app.config.ts)

```typescript
import { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'EyeGo',
  slug: 'eyego-rider',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'dark',  // Forces dark mode system-wide
  splash: {
    image: './assets/images/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0A0A0A',
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.eyego.rider',
    buildNumber: '1',
    usesAppleSignIn: true,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'EyeGo needs your location to show nearby rides and track your pickup.',
      NSLocationAlwaysUsageDescription:
        'EyeGo needs your location to show nearby rides.',
      NSCameraUsageDescription: 'EyeGo uses the camera to set your profile photo.',
      NSPhotoLibraryUsageDescription:
        'EyeGo needs photo access to set your profile picture.',
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon.png',
      backgroundColor: '#0A0A0A',
    },
    package: 'com.eyego.rider',
    versionCode: 1,
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'CAMERA',
      'READ_EXTERNAL_STORAGE',
      'RECEIVE_BOOT_COMPLETED',
      'VIBRATE',
      'POST_NOTIFICATIONS',
    ],
  },
  extra: {
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID },
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-secure-store',
    [
      'expo-notifications',
      {
        icon: './assets/images/notification-icon.png',
        color: '#1DB954',
      },
    ],
    [
      '@rnmapbox/maps',
      { RNMapboxMapsDownloadToken: process.env.MAPBOX_DOWNLOAD_TOKEN },
    ],
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'EyeGo needs your location to track rides.',
      },
    ],
  ],
};

export default config;
```

### 20.2 Metro Config (both apps)

```javascript
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch all workspace packages
config.watchFolders = [workspaceRoot];

// Resolve packages from workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = withNativeWind(config, { input: './global.css' });
```

---

## 21. Environment Configuration

### 21.1 .env files (both apps — never commit these)

```bash
# apps/rider/.env
EXPO_PUBLIC_API_URL=https://api.eyego.app/v1
EXPO_PUBLIC_MAPBOX_TOKEN=pk.eyJ...
EXPO_PUBLIC_EAS_PROJECT_ID=your-eas-project-id
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-google-client-id
MAPBOX_DOWNLOAD_TOKEN=sk.eyJ...  ← NOT public, for build only
```

```bash
# apps/driver/.env
EXPO_PUBLIC_API_URL=https://api.eyego.app/v1
EXPO_PUBLIC_MAPBOX_TOKEN=pk.eyJ...
EXPO_PUBLIC_EAS_PROJECT_ID=your-driver-eas-project-id
MAPBOX_DOWNLOAD_TOKEN=sk.eyJ...
```

**Rule for agents:** Variables prefixed `EXPO_PUBLIC_` are bundled into the app and accessible via `process.env.EXPO_PUBLIC_*`. Variables WITHOUT that prefix are build-time only (used in `app.config.ts`) and never exposed to the app at runtime. Never move a non-public variable to a public prefix.

---

## 22. Agent Prompt Templates

> These are templates for prompting Claude Code / Antigravity / GLM when building specific features.
> Use these exactly — they prevent agents from making architectural decisions.

### 22.1 Building a New Screen

```
Build the [SCREEN NAME] screen for the [rider/driver] app.
File location: apps/[rider/driver]/app/[path].tsx

Requirements from PRD section [X.X]:
[paste the relevant section]

Rules:
- Use ONLY the packages listed in the PRD package manifest
- Import components from @eyego/ui — do not create inline component styles
- Import design tokens from @eyego/config — no hardcoded colour values
- Use Zustand stores defined in the PRD — do not create new stores
- Use TanStack Query for all API calls — do not use useEffect + fetch
- Animations must use moti or react-native-reanimated — no Animated API
- Typography: use the Text primitive from @eyego/ui — no raw <Text> from RN
- All pressable elements must use the Pressable primitive from @eyego/ui
- The screen must handle: loading state (Skeleton), error state (toast), empty state (EmptyState)
- Do not add any navigation logic not specified in section 7
```

### 22.2 Building a Shared Component

```
Build the [COMPONENT NAME] component in packages/ui/src/components/[ComponentName].tsx

Requirements from PRD section 15.[X]:
[paste the relevant section]

Rules:
- Props interface must match exactly what is specified
- Export the component from packages/ui/src/index.ts
- Use ONLY react-native core + moti + react-native-reanimated for animations
- No external styling libraries inside shared components — use StyleSheet.create
- Component must accept a 'style' prop for override capability
- Must work in both rider app (ecoGreen accents) and driver app (driverOrange accents)
  — accept a 'tint' prop: 'eco' | 'comfort' | 'driver' that maps to the correct colour
- Write TypeScript — no 'any' types
```

### 22.3 Building an API Function

```
Add the [ENDPOINT NAME] API function to packages/api/src/endpoints/[file].api.ts

Endpoint spec from PRD section 8.4:
[paste the relevant endpoint]

Rules:
- Use the existing apiClient from ../client — do not create a new axios instance
- Return the full AxiosResponse typed with ApiResponse<T> from @eyego/types
- Add the query key to packages/api/src/queryKeys.ts following the existing factory pattern
- Export the function from the endpoint file's named export object
- Do not add error handling inside the function — errors propagate to TanStack Query
```

### 22.4 Fixing a Styling Issue

```
The [screen/component] does not match the design system.

Issue: [describe what looks wrong]

Design system rules to apply:
- Background colours: background #0A0A0A, surface #141414, surfaceElevated #1E1E1E
- Never hardcode a colour — use colors from @eyego/config
- Font: Display headlines = ClashDisplay-Bold, UI text = Satoshi-[weight], numbers = JetBrainsMono-Bold
- Border radius: chips 8px, cards 14px, sheets 24px, modals 28px
- Spacing: use multiples of 4px only (4, 8, 12, 16, 20, 24, 32)
- Shadows: see PRD section 6.3

Do not change any logic — fix styling only.
```

---

## 23. Build Order & Milestones

### Phase 0 — Foundation (Week 1)

```
Day 1:
  [ ] Create monorepo: yarn workspaces, all packages scaffolded
  [ ] Both Expo apps initialised with expo create --template
  [ ] Shared packages: config, types, api, ui, utils — empty but importable
  [ ] Git repo, .gitignore (include .env, node_modules)

Day 2:
  [ ] Install all packages from manifest (section 4)
  [ ] Configure metro.config.js (monorepo resolver)
  [ ] Configure babel.config.js (NativeWind + Reanimated)
  [ ] tailwind.config.js for both apps

Day 3:
  [ ] Download and add all fonts to both apps/assets/fonts/
  [ ] Font loading in _layout.tsx verified (no "font not found" errors)
  [ ] Design tokens in @eyego/config fully typed and exported
  [ ] Text primitive built and tested

Day 4:
  [ ] Pressable primitive
  [ ] Button component (all variants)
  [ ] Input component (with floating label)
  [ ] Basic navigation structure (all routes defined, empty screens)

Day 5–6:
  [ ] Auth store (Zustand + SecureStore persist)
  [ ] API client (Axios + interceptors)
  [ ] Auth gate in root layout works (redirects correctly)
  [ ] Register accounts: Expo, Mapbox, Paystack, Africa's Talking, Firebase
```

### Phase 1 — Auth + Onboarding (Week 2)

```
  [ ] Onboarding slides (FlatList paging + dots)
  [ ] Phone number entry screen
  [ ] OTP screen (6 boxes, autofill, countdown, shake on error)
  [ ] Profile completion screen (with image picker)
  [ ] Google Sign-In working (Android)
  [ ] Apple Sign-In working (iOS — test on physical iPhone via EAS dev build)
  [ ] Auth flow end-to-end: phone → OTP → register → home
```

### Phase 2 — Core Rider Flow (Weeks 3–5)

```
Week 3:
  [ ] Home screen map (Mapbox dark, floating bottom sheet, ride cards)
  [ ] Van markers on map (static positions first, then WebSocket)
  [ ] OTPInput, RideCard, SeatBar, TierSelector components

Week 4:
  [ ] Ride selection screen (route + tier + heavy load)
  [ ] Ride detail screen (live seat count, AnimatedFareText)
  [ ] WebSocket setup (useRideSocket hook)
  [ ] Invite group screen (share link, roster)

Week 5:
  [ ] Payment screen (MoMo network selection + polling)
  [ ] Card payment WebView flow
  [ ] Live tracking screen (animated van + ETA)
  [ ] Post-ride rating screen
```

### Phase 3 — Driver App (Weeks 6–7)

```
Week 6:
  [ ] Driver registration (multi-step form)
  [ ] Driver pending approval screen
  [ ] Driver home (online toggle, wallet card, assigned ride)
  [ ] Background GPS broadcasting (expo-location + TaskManager)

Week 7:
  [ ] Active ride screen (map + next stop)
  [ ] Passenger manifest (seat floor plan, status rows)
  [ ] Add cash passenger flow (OTP send)
  [ ] OTP verification on manifest
  [ ] Earnings screen (with SVG bar chart)
  [ ] Wallet screen
```

### Phase 4 — Polish + QA (Week 8)

```
  [ ] Skeleton loading states on all data-fetching screens
  [ ] Empty states with Lottie animations
  [ ] Toast notifications for all user actions
  [ ] Push notification handling (foreground + background tap)
  [ ] Deep link handling (join/[token] route)
  [ ] Light mode toggle (uiStore.theme — apply light token set)
  [ ] End-to-end test: full rider booking flow
  [ ] End-to-end test: offline passenger OTP flow
  [ ] Build Android APK (EAS preview build)
  [ ] Build iOS .ipa (EAS preview build, install on iPhone)
  [ ] Test on physical Android device
  [ ] Test on physical iPhone
```

### Phase 5 — Launch Build (Week 9+)

```
  [ ] Paystack account in LIVE mode (not test)
  [ ] Africa's Talking production credits loaded
  [ ] EAS production builds (Android AAB + iOS IPA)
  [ ] Submit Android to Play Store (Internal Testing)
  [ ] Submit iOS to TestFlight
  [ ] Recruit 10 drivers, set isApproved = true in DB
  [ ] September 1st: Graduate to production
```

---

## Appendix A — TypeScript Types (packages/types/src)

```typescript
// packages/types/src/api.types.ts
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// packages/types/src/ride.types.ts
export type RideTier = 'ECO' | 'COMFORT';
export type RideStatus =
  | 'SCHEDULED'
  | 'FILLING'
  | 'LOCKED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export interface Ride {
  id: string;
  routeId: string;
  vehicleId: string;
  driverId: string;
  tier: RideTier;
  status: RideStatus;
  scheduledAt: string;
  maxCapacity: number;
  minOccupancyToStart: number;
  farePerSeat: number;
  shareToken: string;
  confirmedSeats: number;
  driver?: Driver;
  vehicle?: Vehicle;
  route?: Route;
}

export interface RideOccupancy {
  rideId: string;
  confirmedSeats: number;
  farePerSeat: number;
  pendingSeats: number;
  emptySeats: number;
}

// packages/types/src/booking.types.ts
export type BookingStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'BOARDED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface Booking {
  id: string;
  rideId: string;
  riderId?: string;
  stopId?: string;
  status: BookingStatus;
  seatNumber?: number;
  fareAmount: number;
  isCoveredByLead: boolean;
  isOfflinePassenger: boolean;
  offlinePhone?: string;
  paidAt?: string;
  boardedAt?: string;
  rider?: User;
}
```

---

## Appendix B — Common Agent Mistakes to Prevent

Tell your agents these rules at the start of every session:

```
1. NEVER install expo-camera — use expo-image-picker for photo capture
2. NEVER use React Navigation directly — use Expo Router only
3. NEVER use AsyncStorage — use expo-secure-store for sensitive data, 
   Zustand with SecureStore adapter for auth state
4. NEVER use the Animated API from React Native — use moti or reanimated
5. NEVER hardcode colour values — import from @eyego/config
6. NEVER use <Text> from react-native — use the Text primitive from @eyego/ui
7. NEVER create a new Axios instance — use apiClient from @eyego/api
8. NEVER store API response data in Zustand — use TanStack Query
9. NEVER write inline styles with hardcoded colours or font names
10. NEVER add a new package without checking the PRD package manifest first
11. NEVER eject from Expo managed workflow
12. NEVER use firebase/database or firebase/firestore — backend is Node.js
13. ALWAYS handle three states for data screens: loading, error, success
14. ALWAYS use FlashList from @shopify/flash-list — never FlatList for lists
15. ALWAYS wrap Pressable elements in the Pressable primitive for scale animation
```

---

*End of EyeGo React Native + Expo PRD v2.0*
*Next step: Set up the monorepo (Phase 0, Day 1). Create the folder structure exactly as specified in section 5 before writing any component code.*
