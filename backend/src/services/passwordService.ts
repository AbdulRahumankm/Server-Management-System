import { hash, verify } from '@node-rs/argon2';

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  return verify(passwordHash, plain);
}
