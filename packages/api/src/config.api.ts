import { apiClient } from './client';

export const configApi = {
  getDynamicConfig: () => apiClient.get('/config/mobile'),
};
