export interface DashboardActivity {
  id: string;
  user: { id: string; name: string; email: string } | null;
  action: string;
  resourceType: string;
  createdAt: string;
}

export interface DashboardStats {
  totalServers: number;
  linuxServers: number;
  windowsServers: number;
  productionServers: number;
  uatServers: number;
  developmentServers: number;
  totalKeys: number;
  recentActivity: DashboardActivity[];
}
