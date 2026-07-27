const TELEBIRR_HOST = "transactioninfo.ethiotelecom.et";
const TELEBIRR_PATH_PREFIX = "/receipt/";

export function normalizeReceiptReference(ref: string, channelType?: string): string {
  if (
    channelType === "telebirr" &&
    ref.startsWith(`https://${TELEBIRR_HOST}${TELEBIRR_PATH_PREFIX}`)
  ) {
    return ref.split("/").pop()!;
  }
  return ref;
}
