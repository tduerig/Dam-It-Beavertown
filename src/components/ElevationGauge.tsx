import { useGameStore } from '../store';

export function ElevationGauge() {
  const playerPos = useGameStore(state => state.playerPosition);
  const zPos = playerPos[2];
  
  // Map Z from -300 (Peak) to +300 (Ocean)
  // -300 -> 0% (Top)
  // +300 -> 100% (Bottom)
  const elevationPercent = Math.max(0, Math.min(100, ((zPos + 300) / 600) * 100));

  return (
    <div className="absolute bottom-4 right-48 w-12 h-40 border-4 border-amber-900 rounded-lg overflow-hidden bg-amber-100/50 shadow-lg pointer-events-auto flex flex-col">
      <div className="bg-amber-900 text-amber-100 text-[10px] text-center py-1 font-bold tracking-wider z-10">ALT</div>
      <div className="relative flex-1 w-full">
        {/* Gradient Background representing biomes */}
        <div 
          className="absolute inset-0 w-full h-full" 
          style={{ 
            background: 'linear-gradient(to bottom, #ffffff 0%, #888888 25%, #4a5d23 50%, #e6d59d 85%, #1e3a8a 100%)' 
          }} 
        />
        
        {/* Labels */}
        <span className="absolute top-1 left-1 text-[8px] font-bold text-black/50">PEAK</span>
        <span className="absolute bottom-1 left-1 text-[8px] font-bold text-white/80">SEA</span>
        
        {/* Player Marker */}
        <div 
          className="absolute left-0 w-full h-1 bg-red-500 shadow-[0_0_4px_black] transition-all duration-100"
          style={{ top: `${elevationPercent}%`, transform: 'translateY(-50%)' }}
        />
      </div>
    </div>
  );
}
