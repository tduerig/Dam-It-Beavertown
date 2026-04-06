export interface TerrainConfig {
  riverWidth: number;
  riverDepth: number;
  twistFrequency: number;
  twistAmplitude: number;
  slope: number;
}

export const globalTerrainConfig: TerrainConfig = {
  riverWidth: 8,
  riverDepth: 3,
  twistFrequency: 0.01,
  twistAmplitude: 15,
  slope: 0.1
};

export function updateTerrainConfig(config: Partial<TerrainConfig>) {
  Object.assign(globalTerrainConfig, config);
}
