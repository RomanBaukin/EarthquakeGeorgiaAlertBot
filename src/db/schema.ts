import type { Generated } from "kysely";

export interface ChatTable {
  id: number;
  type: string;
  title: string | null;
  created_at: Generated<string>;
}

export interface SubscriptionTable {
  id: Generated<number>;
  chat_id: number;
  active: Generated<number>;
  min_magnitude: Generated<number>;
  region_keyword: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface EarthquakeEventTable {
  id: Generated<number>;
  dedupe_key: string;
  source_time_raw: string;
  source_time: string;
  magnitude: number;
  depth_km: number | null;
  latitude: number | null;
  longitude: number | null;
  coordinates_raw: string;
  region: string;
  notified_at: string | null;
  created_at: Generated<string>;
}

export interface Database {
  chat: ChatTable;
  subscription: SubscriptionTable;
  earthquake_event: EarthquakeEventTable;
}
