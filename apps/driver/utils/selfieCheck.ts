import * as ImagePicker from 'expo-image-picker';
import { driverApi } from '@eyego/api';
import { notify } from '@eyego/ui';

/**
 * The real-time ID selfie goOnline asks for (SELFIE_REQUIRED — see
 * drivers.service.submitSelfieCheck). Front camera, straight to the server.
 * Resolves true once it is stored, so the caller can retry going online.
 */
export async function takeSelfieCheck(): Promise<boolean> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    notify('Camera needed', 'Allow camera access in Settings to take your selfie.');
    return false;
  }
  const shot = await ImagePicker.launchCameraAsync({
    cameraType: ImagePicker.CameraType.front,
    quality: 0.6,
    allowsEditing: false,
  });
  const uri = shot.canceled ? null : shot.assets?.[0]?.uri;
  if (!uri) return false;
  const form = new FormData();
  form.append('file', { uri, name: 'selfie.jpg', type: 'image/jpeg' } as any);
  try {
    await driverApi.selfieCheck(form);
    return true;
  } catch (err: any) {
    notify('Could not upload your selfie', err?.response?.data?.message ?? 'Please try again.');
    return false;
  }
}
