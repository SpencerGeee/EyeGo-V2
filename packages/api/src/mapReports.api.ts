import type { ApiResponse } from '@eyego/types';
import { apiClient } from './client';

/**
 * "Improve maps" — corrections riders and drivers file about the real world.
 *
 * See eyego-api/src/services/map-report.service.js for the model. The six types
 * share one row and differ only in a payload blob, which is why this surface is
 * one call rather than six.
 */

export type MapReportType =
  | 'ADD_PLACE'
  | 'EDIT_PLACE'
  | 'EDIT_ADDRESS'
  | 'ADD_OBJECT'
  | 'ROAD_ISSUE'
  | 'COMMENT';

export type MapReportStatus = 'PENDING' | 'IN_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'DUPLICATE';

export interface MapReport {
  id: string;
  type: MapReportType;
  status: MapReportStatus;
  lat: number;
  lng: number;
  name?: string | null;
  address?: string | null;
  note?: string | null;
  payload?: Record<string, unknown> | null;
  photos?: string[];
  /** Why it was rejected, or what was done about it. Null until reviewed. */
  reviewNote?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

export interface MapReportDraft {
  type: MapReportType;
  lat: number;
  lng: number;
  name?: string | null;
  address?: string | null;
  note?: string | null;
  payload?: Record<string, unknown> | null;
  photos?: string[];
}

/**
 * Post one local image file and get back the URL to put in `photos[]`.
 *
 * Uploaded as it is picked rather than as part of the report body — see the
 * long note on the endpoint in eyego-api/src/modules/map-reports. Shaped
 * exactly like `userApi.uploadAvatar`, including the React Native `{ uri, name,
 * type }` blob form, which is the only file shape RN's FormData accepts.
 */
async function postPhoto(path: string, uri: string): Promise<string> {
  const formData = new FormData();
  const filename = uri.split('/').pop() ?? 'photo.jpg';
  const match = /\.(\w+)$/.exec(filename);
  // The server checks the real mime type against an allow-list; this is only
  // what RN puts in the part header, and a wrong guess here is what makes an
  // otherwise valid HEIC upload get rejected.
  const ext = match?.[1]?.toLowerCase();
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'heic' ? 'image/heic' : 'image/jpeg';
  formData.append('photo', { uri, name: filename, type } as unknown as Blob);

  const res = await apiClient.post<ApiResponse<{ url: string }>>(path, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // A photo on a Ghanaian mobile connection is not a 10-second request. The
    // client's default would abort a perfectly good upload most of the way in.
    timeout: 60_000,
  });
  return res.data.data.url;
}

export const mapReportsApi = {
  /**
   * What the server accepts, so the forms are rendered from the server's own
   * vocabulary rather than a copy of it. Adding a report type is then a server
   * change, not a coordinated release of three clients that each believe
   * something different about what ROAD_ISSUE collects.
   */
  getSchema: () =>
    apiClient.get<ApiResponse<{
      types: MapReportType[];
      statuses: MapReportStatus[];
      payloadShapes: Record<string, Record<string, { type: string; max?: number; values?: string[] }> | null>;
      maxPhotos: number;
      maxNoteLength: number;
    }>>('/map-reports/schema'),

  create: (draft: MapReportDraft) =>
    apiClient.post<ApiResponse<{ report: MapReport }>>('/map-reports', draft),

  /** The same verb from the driver app, which carries a different token. */
  createAsDriver: (draft: MapReportDraft) =>
    apiClient.post<ApiResponse<{ report: MapReport }>>('/map-reports/driver', draft),

  /** Local file URI → a stored URL for `photos[]`. See `postPhoto`. */
  uploadPhoto: (uri: string) => postPhoto('/map-reports/photo', uri),
  uploadPhotoAsDriver: (uri: string) => postPhoto('/map-reports/driver/photo', uri),

  mine: (params?: { limit?: number; cursor?: string | null }) =>
    apiClient.get<ApiResponse<{ reports: MapReport[]; nextCursor: string | null }>>('/map-reports/mine', {
      params,
    }),

  /** What has already been said about this corner — shown on the picker map. */
  nearby: (lat: number, lng: number, radiusKm = 2) =>
    apiClient.get<ApiResponse<{ reports: MapReport[] }>>('/map-reports/nearby', {
      params: { lat, lng, radiusKm },
    }),

  getById: (id: string) => apiClient.get<ApiResponse<{ report: MapReport }>>(`/map-reports/${id}`),
};
