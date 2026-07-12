// Map system lives in @eyego/maps — the shared MapLibre v11 + OpenFreeMap
// adapter also used by the driver app. Both apps run the same free, keyless
// map system by design (no Google Maps Cloud Billing account needed on
// either platform). Re-exported under this path so existing screen imports
// (`import MapboxGL from '../../utils/mapbox'`) don't need to change.
export { NavCamera, MapAvailable } from '@eyego/maps';
export type { LngLat, CameraRef, MapViewProps, CameraProps, NavCameraProps } from '@eyego/maps';
import MapboxGL from '@eyego/maps';

export default MapboxGL;
