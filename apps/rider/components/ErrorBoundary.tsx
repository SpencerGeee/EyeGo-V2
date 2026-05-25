import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, StyleSheet, Pressable, DevSettings, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Enterprise Telemetry Integration: Log to Console/Sentry/Firebase here
    console.error('🚨 [Global ErrorBoundary] Caught fatal crash:', error, errorInfo);
  }

  private handleRestart = () => {
    try {
      DevSettings.reload();
    } catch {
      this.setState({ hasError: false, error: null });
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.content}>
            <View style={styles.iconContainer}>
              <Ionicons name="warning-outline" size={48} color="#FF5252" />
            </View>
            <Text style={[styles.title, { fontSize: 20, fontWeight: 'bold' }]}>Something went wrong</Text>
            <Text style={styles.subtitle}>
              The application encountered an unexpected error. Our team has been notified.
            </Text>
            
            {__DEV__ && (
              <View style={styles.devError}>
                <Text style={styles.devErrorText}>{this.state.error?.toString()}</Text>
              </View>
            )}

            <Pressable
              onPress={this.handleRestart}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Restart App</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050508',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    maxWidth: 320,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 82, 82, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  devError: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 24,
    maxHeight: 150,
  },
  devErrorText: {
    color: '#FF5252',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  button: {
    width: '100%',
    height: 48,
    backgroundColor: '#4BE277',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  buttonText: {
    color: '#050508',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
