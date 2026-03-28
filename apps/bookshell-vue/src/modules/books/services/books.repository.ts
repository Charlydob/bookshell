import { createLogger } from '@/shared/services/logger';

const logger = createLogger('books.repository');

export async function listBooks() {
  logger.info('TODO listBooks');
  return [];
}
