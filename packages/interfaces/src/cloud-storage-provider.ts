/**
 * CloudStorageProvider — interface for cloud backup storage (PERSIST-011).
 *
 * Production implementation: S3CloudStorageProvider (AWS S3, CELLO_ENV=dev+).
 * Local stub: LocalCloudStorageProvider (filesystem-based, CELLO_ENV=local).
 */
export interface CloudStorageProvider {
  /** Upload data to the given key path. Overwrites if exists. */
  upload(key: string, data: Uint8Array): Promise<void>;

  /** Download data from the given key path. Returns undefined if not found. */
  download(key: string): Promise<Uint8Array | undefined>;
}
