export interface TerrainConfig {
  riverWidth: number;
  riverDepth: number;
  twistFrequency: number;
  twistAmplitude: number;
  slope: number;
  waterSourceRate: number;
  groundAbsorptionRate: number;
  waterRenderThreshold: number;
  bankLipHeight: number;
  bankSlope: number;
}

export const globalTerrainConfig: TerrainConfig = {
  riverWidth: 8,
  riverDepth: 3,
  twistFrequency: 0.01,
  twistAmplitude: 15,
  slope: 0.1,
  waterSourceRate: 0.18,
  groundAbsorptionRate: 0.0001,
  waterRenderThreshold: 0.05,
  bankLipHeight: 5.0,
  bankSlope: 0.5
};

export function updateTerrainConfig(config: Partial<TerrainConfig>) {
  Object.assign(globalTerrainConfig, config);
}
