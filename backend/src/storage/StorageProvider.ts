export interface StorageProvider {
  put(id: string, plaintext: Buffer): Promise<{ storageRef: string; iv: string; authTag: string }>;
  get(storageRef: string, iv: string, authTag: string): Promise<Buffer>;
  delete(storageRef: string): Promise<void>;
}
