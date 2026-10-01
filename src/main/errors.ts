// Errors carry a flag or two between the LED layers, and `catch` gives us `unknown`.

export interface AppError extends Error {
  /** A connect that a later disconnect superseded: not a real failure. */
  cancelled?: boolean;
  /** Retrying cannot help (no Bluetooth permission, missing native library). */
  fatal?: boolean;
}

export const asError = (err: unknown): AppError =>
  err instanceof Error ? err : new Error(typeof err === 'string' ? err : String(err));

export const messageOf = (err: unknown): string => asError(err).message;

/** An error with our extra flags set. */
export const fail = (message: string, flags: Omit<Partial<AppError>, 'name' | 'message'> = {}): AppError =>
  Object.assign(new Error(message), flags);
