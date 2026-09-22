export interface SSHKeyMetadata {
  id: string;
  name: string;
  keyType: string;
  description: string | null;
  owner: { id: string; name: string; email: string };
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignedServer: { id: string; hostname: string } | null;
}
