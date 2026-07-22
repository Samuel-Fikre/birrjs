export async function collectFingerprint(): Promise<string | null> {
  try {
    const { getThumbmark } = await import("@thumbmarkjs/thumbmarkjs");
    const result = await getThumbmark();
    return result.thumbmark;
  } catch {
    return null;
  }
}
