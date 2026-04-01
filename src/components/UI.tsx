import { useRef, useEffect, useState } from 'react';
import { useGameStore } from '../store';
import { Hammer, Droplets, TreePine, Download, Upload, CloudRain, ArrowUp, ArrowDown } from 'lucide-react';
import { Minimap } from './Minimap';
import { ElevationGauge } from './ElevationGauge';
import { VirtualJoystick } from './VirtualJoystick';

export function UI() {
  const inventory = useGameStore((state) => state.inventory);
  const rainIntensity = useGameStore((state) => state.rainIntensity);
  const saveGame = useGameStore((state) => state.saveGame);
  const loadGame = useGameStore((state) => state.loadGame);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setVirtualJoystick = useGameStore((state) => state.setVirtualJoystick);
  const setVirtualCamera = useGameStore((state) => state.setVirtualCamera);
  const setVirtualButton = useGameStore((state) => state.setVirtualButton);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 1024 || 'ontouchstart' in window);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleLoadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        loadGame(content);
      }
    };
    reader.readAsText(file);
    
    // Reset input so the same file can be loaded again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Crosshair */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full opacity-50" />

      {/* Inventory & Save/Load */}
      <div className="absolute bottom-4 left-4 flex flex-col gap-4 pointer-events-auto">
        <div className="bg-black/50 p-4 rounded-lg text-white font-mono flex gap-6 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <TreePine className="w-6 h-6 text-amber-600" />
            <span className="text-xl">{inventory.sticks}</span>
          </div>
          <div className="flex items-center gap-2">
            <Droplets className="w-6 h-6 text-amber-900" />
            <span className="text-xl">{inventory.mud}</span>
          </div>
          <div className="flex items-center gap-2 ml-4 border-l border-white/20 pl-6">
            <CloudRain className={`w-6 h-6 ${rainIntensity > 0 ? 'text-blue-400' : 'text-gray-500'}`} />
            <span className="text-xl">{Math.round(rainIntensity * 100)}%</span>
          </div>
        </div>
        
        <div className="flex gap-2">
          <button 
            onClick={() => saveGame()}
            className="flex-1 bg-amber-700/80 hover:bg-amber-600 text-amber-100 py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors border border-amber-900/50 backdrop-blur-sm"
          >
            <Download size={18} /> Save Map
          </button>
          <button 
            onClick={handleLoadClick}
            className="flex-1 bg-amber-700/80 hover:bg-amber-600 text-amber-100 py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors border border-amber-900/50 backdrop-blur-sm"
          >
            <Upload size={18} /> Load Map
          </button>
          <input 
            type="file" 
            accept=".json" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            className="hidden" 
          />
        </div>
      </div>

      {/* Controls */}
      <div className="absolute top-4 right-4 bg-black/50 p-4 rounded-lg text-white font-mono text-sm backdrop-blur-sm hidden lg:block">
        <h3 className="font-bold mb-2 text-lg">Controls</h3>
        <ul className="space-y-1">
          <li><span className="text-yellow-400">WASD</span> - Move</li>
          <li><span className="text-yellow-400">Arrows</span> - Rotate Camera</li>
          <li><span className="text-yellow-400">+/-</span> - Adjust Rain</li>
          <li><span className="text-yellow-400">SPACE</span> - Jump</li>
          <li><span className="text-yellow-400">SHIFT/C</span> - Dive / Crouch</li>
          <li><span className="text-yellow-400">E</span> - Collect (near tree/water)</li>
          <li><span className="text-yellow-400">F</span> - Place Stick</li>
          <li><span className="text-yellow-400">G</span> - Place Mud</li>
        </ul>
      </div>

      {/* Minimap & Elevation Gauge */}
      <ElevationGauge />
      <Minimap />

      {/* Mobile Controls */}
      {isMobile && (
        <div className="absolute inset-0 pointer-events-none z-50">
          {/* Left Joystick - Movement */}
          <div className="absolute bottom-24 left-8 pointer-events-auto">
            <VirtualJoystick onMove={(x, y) => setVirtualJoystick(x, y)} />
          </div>

          {/* Right Joystick - Camera */}
          <div className="absolute bottom-24 right-8 pointer-events-auto">
            <VirtualJoystick onMove={(x, y) => setVirtualCamera(x, y)} />
          </div>

          {/* Action Buttons */}
          <div className="absolute bottom-8 right-8 flex gap-4 pointer-events-auto">
            <button
              className="w-16 h-16 rounded-full bg-black/50 border-2 border-white/20 flex items-center justify-center text-white active:bg-white/30 backdrop-blur-sm"
              onPointerDown={() => setVirtualButton('action1', true)}
              onPointerUp={() => setVirtualButton('action1', false)}
              onPointerLeave={() => setVirtualButton('action1', false)}
            >
              <Hammer size={24} />
            </button>
            <button
              className="w-16 h-16 rounded-full bg-black/50 border-2 border-white/20 flex items-center justify-center text-white active:bg-white/30 backdrop-blur-sm"
              onPointerDown={() => setVirtualButton('action2', true)}
              onPointerUp={() => setVirtualButton('action2', false)}
              onPointerLeave={() => setVirtualButton('action2', false)}
            >
              <TreePine size={24} />
            </button>
            <button
              className="w-16 h-16 rounded-full bg-black/50 border-2 border-white/20 flex items-center justify-center text-white active:bg-white/30 backdrop-blur-sm"
              onPointerDown={() => setVirtualButton('action3', true)}
              onPointerUp={() => setVirtualButton('action3', false)}
              onPointerLeave={() => setVirtualButton('action3', false)}
            >
              <Droplets size={24} />
            </button>
          </div>

          {/* Jump/Dive Buttons */}
          <div className="absolute bottom-8 left-8 flex gap-4 pointer-events-auto">
            <button
              className="w-16 h-16 rounded-full bg-black/50 border-2 border-white/20 flex items-center justify-center text-white active:bg-white/30 backdrop-blur-sm"
              onPointerDown={() => setVirtualButton('jump', true)}
              onPointerUp={() => setVirtualButton('jump', false)}
              onPointerLeave={() => setVirtualButton('jump', false)}
            >
              <ArrowUp size={24} />
            </button>
            <button
              className="w-16 h-16 rounded-full bg-black/50 border-2 border-white/20 flex items-center justify-center text-white active:bg-white/30 backdrop-blur-sm"
              onPointerDown={() => setVirtualButton('crouch', true)}
              onPointerUp={() => setVirtualButton('crouch', false)}
              onPointerLeave={() => setVirtualButton('crouch', false)}
            >
              <ArrowDown size={24} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
