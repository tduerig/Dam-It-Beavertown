import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../store';
import { waterEngine } from '../utils/WaterEngine';
import { globalBeaverAI } from '../utils/BeaverAI';

export function BeaverBrain() {
  const { autopilot, setAITarget } = useGameStore();

  useEffect(() => {
    if (!autopilot) {
      setAITarget(null);
      globalBeaverAI.transition('IDLE', performance.now(), 'Offline');
    }
  }, [autopilot]);

  useFrame(() => {
    if (!autopilot) return;
    globalBeaverAI.tick(performance.now(), waterEngine);
  });

  return null;
}
