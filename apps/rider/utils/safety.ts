import { Share, Alert } from 'react-native';

export const shareLiveTracking = async (tripId: string, driverName: string, vehicleInfo: string) => {
  try {
    const trackingUrl = `https://eyego.app/track/${tripId}`;
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
