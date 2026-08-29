export interface Coordinates {
  latitude: number;
  longitude: number;
}

export function parseCoordinates(raw: string): Coordinates | null {
  const parts = raw.split("/");
  if (parts.length !== 2) return null;

  const latitude = Number.parseFloat(parts[0]!.trim());
  const longitude = Number.parseFloat(parts[1]!.trim());
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;

  return { latitude, longitude };
}

export function buildMapLinks(latitude: number, longitude: number): {
  google: string;
  osm: string;
} {
  return {
    google: `https://www.google.com/maps?q=${latitude},${longitude}`,
    osm: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=9/${latitude}/${longitude}`,
  };
}
