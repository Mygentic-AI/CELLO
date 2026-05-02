export type PublicKey = Uint8Array; // 32-byte Ed25519 public key
export type Signature = Uint8Array; // 64-byte Ed25519 signature

export interface KeyProvider {
  getPublicKey(): Promise<PublicKey>;
  sign(data: Uint8Array): Promise<Signature>;
}

export interface KeyFileCorruptError {
  reason: "key_file_corrupt";
  message: string;
}
