// Map system lives in @eyego/maps (shared with the rider app once its own
// migration lands — see docs/superpowers/plans/2026-07-08-driver-app-onyx-equip.md
// Phase M). Re-exported under this path so existing screen imports
// (`import MapboxGL from '../../../utils/mapbox'`) don't need to change.
export { NavCamera, MapAvailable } from '@eyego/maps';
export type { LngLat, CameraRef, MapViewProps, CameraProps, NavCameraProps } from '@eyego/maps';
import MapboxGL from '@eyego/maps';

export default MapboxGL;
