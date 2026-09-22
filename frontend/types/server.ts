export type OperatingSystem = 'LINUX' | 'WINDOWS' | 'OTHER';
export type Environment = 'PRODUCTION' | 'UAT' | 'DEVELOPMENT' | 'TEST';
export type ServerStatus = 'ACTIVE' | 'INACTIVE' | 'DECOMMISSIONED';

export interface Server {
  id: string;
  hostname: string;
  ipAddress: string;
  os: OperatingSystem;
  environment: Environment;
  application: string;
  owner: string;
  location: string | null;
  username: string;
  sshPort: number;
  description: string | null;
  status: ServerStatus;
  assignedKey: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedServers {
  data: Server[];
  total: number;
  page: number;
  pageSize: number;
}
