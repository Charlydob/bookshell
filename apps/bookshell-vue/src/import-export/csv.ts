export function buildCsvTemplate(headers: string[]): string {
  return `${headers.join(',')}\n`;
}
