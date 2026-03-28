import type { PlaceholderRecord } from '@/types/common';

export interface MediaRecord extends PlaceholderRecord {
  type?: 'movie' | 'series' | 'anime';
}
