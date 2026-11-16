export const PASSWORD_HINT = 'Use at least 8 characters. Known breached passwords are refused.';

export function newPasswordError(password: string): string | null {
  if ([...password].length < 8) return 'Use at least 8 characters for your password.';
  if (new TextEncoder().encode(password).length > 72) return 'Use at most 72 UTF-8 bytes for your password (some characters use more than one byte).';
  return null;
}
