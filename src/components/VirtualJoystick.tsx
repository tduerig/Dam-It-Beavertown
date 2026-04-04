import { useRef, useEffect, useState } from 'react';

interface VirtualJoystickProps {
  onMove: (x: number, y: number) => void;
  className?: string;
}

export function VirtualJoystick({ onMove, className = '' }: VirtualJoystickProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const activeTouchId = useRef<number | null>(null);
  const isMouseDown = useRef(false);

  const handleStart = (e: React.TouchEvent | React.MouseEvent) => {
    if ('touches' in e && activeTouchId.current !== null) return;
    
    const clientX = 'touches' in e ? e.changedTouches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.changedTouches[0].clientY : e.clientY;
    
    if ('touches' in e) {
      activeTouchId.current = e.changedTouches[0].identifier;
    } else {
      isMouseDown.current = true;
    }

    updatePosition(clientX, clientY);
  };

  const handleMove = (e: TouchEvent | MouseEvent) => {
    if ('touches' in e) {
      if (activeTouchId.current === null) return;
      const touch = Array.from(e.changedTouches).find(t => t.identifier === activeTouchId.current);
      if (!touch) return;
      updatePosition(touch.clientX, touch.clientY);
    } else {
      if (!isMouseDown.current) return;
      updatePosition(e.clientX, e.clientY);
    }
  };

  const handleEnd = (e: TouchEvent | MouseEvent) => {
    if ('touches' in e) {
      if (activeTouchId.current === null) return;
      const touch = Array.from(e.changedTouches).find(t => t.identifier === activeTouchId.current);
      if (!touch) return;
      activeTouchId.current = null;
    } else {
      if (!isMouseDown.current) return;
      isMouseDown.current = false;
    }
    
    setPosition({ x: 0, y: 0 });
    onMove(0, 0);
  };

  const updatePosition = (clientX: number, clientY: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const maxDist = rect.width / 2;
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxDist) {
      dx = (dx / dist) * maxDist;
      dy = (dy / dist) * maxDist;
    }

    setPosition({ x: dx, y: dy });
    
    // Normalize to -1 to 1
    onMove(dx / maxDist, dy / maxDist);
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleTouchMove = (e: TouchEvent) => handleMove(e);
    const handleTouchEnd = (e: TouchEvent) => handleEnd(e);
    const handleMouseMove = (e: MouseEvent) => handleMove(e);
    const handleMouseUp = (e: MouseEvent) => handleEnd(e);

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div 
      ref={containerRef}
      className={`w-32 h-32 rounded-full bg-black/30 border-2 border-white/20 relative touch-none ${className}`}
      onMouseDown={handleStart}
      onTouchStart={handleStart}
    >
      <div 
        className="w-12 h-12 rounded-full bg-white/50 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{ transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))` }}
      />
    </div>
  );
}
