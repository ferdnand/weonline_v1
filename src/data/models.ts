/**
 * Provider-agnostic domain models for WeOnline.
 *
 * These were extracted from src/App.tsx (Phase 1 of MIGRATION.md) so the UI and the
 * data layer share a single source of truth that is independent of any backend.
 */

export interface Package {
  id: string;
  name: string;
  speed: string;
  price: number;
  duration: string;
  features: string[];
  popular?: boolean;
}

export interface Subscription {
  id: string;
  packageName: string;
  speed: string;
  price: number;
  activationDate: string;
  expiryDate: string;
  macAddress: string;
  status: 'active' | 'expired';
}

export interface Payment {
  id: string;
  subscriptionId: string;
  packageName: string;
  amount: number;
  date: string;
  phoneNumber: string;
  transactionId: string;
  status: 'completed' | 'failed';
}

export interface Client {
  id: string;
  name: string;
  type: 'hotspot' | 'pppoe';
  planName: string;
  price: number;
  startDate: string;
  expiryDate: string;
  status: 'active' | 'expired';
  online: boolean;
  phoneNumber: string;
  macAddress?: string;
  routerId?: string;
  pppoeUsername?: string;
  pppoePassword?: string;
}

export interface Router {
  id: string;
  name: string;
  location: string;
  ipAddress: string;
  status: 'online' | 'offline';
  model?: string;
  username?: string;
  password?: string;
  apiPort?: number;
  cpu?: number;
  memory?: number;
  uptime?: string;
  temperature?: number;
  clientsCount?: number;
  isMikrotik?: boolean;
}

export interface Transaction {
  id: string;
  clientId: string;
  clientName: string;
  amount: number;
  date: string;
  planName: string;
  type: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  role: 'admin' | 'technician';
  name: string;
}
