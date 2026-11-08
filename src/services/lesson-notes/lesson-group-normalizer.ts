/** Canonical comparison of BARS / RUZ group codes (Latin A in RUZ). */
export function normalizedStudyGroup(value: string): string {
  return value.trim().toUpperCase()
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, '')
    .replace(/A/g, 'А');
}
