const TELEBIRR_HOST = "transactioninfo.ethiotelecom.et";
const TELEBIRR_PATH_PREFIX = "/receipt/";

export function normalizeReceiptReference(ref: string): string {
  if (ref.startsWith(`https://${TELEBIRR_HOST}${TELEBIRR_PATH_PREFIX}`)) {
    return ref.split("/").pop()!;
  }
  return ref;
}
