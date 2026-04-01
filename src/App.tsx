import { Game } from './components/Game';
import { UI } from './components/UI';

export default function App() {
  return (
    <div className="w-full h-screen bg-sky-200 overflow-hidden relative">
      <Game />
      <UI />
    </div>
  );
}
