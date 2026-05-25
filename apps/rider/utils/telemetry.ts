import { Platform } from 'react-native';

export type TelemetrySeverity = 'info' | 'warning' | 'error' | 'critical';

export interface TelemetryEvent {
  eventName: string;
  category: 'payment' | 'auth' | 'booking' | 'navigation' | 'socket' | 'system';
  severity: TelemetrySeverity;
  metadata?: Record<string, any>;
}

export const telemetry = {
  /**
   * Log business transaction events and client errors to console,
   * with easy placeholders for Sentry, Firebase Analytics, or Datadog integrations.
   */
  log(event: TelemetryEvent) {
    const timestamp = new Date().toISOString();
    const platform = Platform.OS;
    
    const formattedLog = `📊 [Telemetry] [${timestamp}] [${event.category.toUpperCase()}] [${event.severity.toUpperCase()}] ${event.eventName} (${platform})`;
    
    if (event.severity === 'critical' || event.severity === 'error') {
      console.error(formattedLog, event.metadata || '');
      // Sentry/Crashlytics hook goes here:
      // Sentry.captureMessage(event.eventName, { level: event.severity, extra: event.metadata });
    } else if (event.severity === 'warning') {
      console.warn(formattedLog, event.metadata || '');
    } else {
      console.log(formattedLog, event.metadata || '');
    }
  }
};
