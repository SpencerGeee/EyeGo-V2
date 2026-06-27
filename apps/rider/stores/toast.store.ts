import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastState {
  visible: boolean;
  message: string;
  type: ToastType;
  show: (message: string, type?: ToastType, duration?: number) => void;
  hide: () => void;
}

let _timer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastState>((set) => ({
  visible: false,
  message: '',
  type: 'info',
  show: (message, type = 'info', duration = 3500) => {
    if (_timer) clearTimeout(_timer);
    set({ visible: true, message, type });
    _timer = setTimeout(() => set({ visible: false }), duration);
  },
  hide: () => {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    set({ visible: false });
  },
}));
