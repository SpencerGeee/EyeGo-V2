import { Share, Alert } from 'react-native';

/**
 * Share a live-tracking link for an active trip.
 * @param shortId  The trip's `shortId` field (cuid — used in /track/:shortId URL)
 * @param driverName  Driver display name
 * @param vehicleInfo  Plate number or vehicle description
 */
export const shareLiveTracking = async (shortId: string, driverName: string, vehicleInfo: string) => {
  try {
    const apiBase = process.env.EXPO_PUBLIC_API_URL?.replace('/v1', '').replace('/api', '') ?? 'https://eyego.app';
    const trackingUrl = `${apiBase}/track/${shortId}`;
    const message = `I'm on an EyeGo trip with ${driverName} (${vehicleInfo}). Follow my ride live here: ${trackingUrl}`;

    await Share.share({
      message,
      url: trackingUrl, // iOS only
      title: 'Track my EyeGo Ride',
    });
  } catch (error) {
    Alert.alert('Error', 'Could not share live tracking link.');
  }
};
