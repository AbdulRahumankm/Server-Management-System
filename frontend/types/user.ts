export interface AppUser {
  id: string;
  email: string;
  name: string;
  authProvider: 'LOCAL' | 'OIDC';
  role: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface AppRole {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
}
