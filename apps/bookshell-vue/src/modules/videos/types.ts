import type { PlaceholderRecord } from '@/types/common';

export interface VideoRecord extends PlaceholderRecord {
  status?: 'idea' | 'drafting' | 'editing' | 'published';
}
