import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot, type Root as ReactRoot } from 'react-dom/client';
import { loadWorld, type World } from './data/world';
import { deleteSave, loadGame, saveGame } from './save';
import { installSystems } from './sim/systems';
import { Game } from './sim/game';
import { App } from './ui/App';
import { TitleScreen } from './ui/TitleScreen';
import { preloadCity } from './world3d/World3DView';
import './ui/styles.css';

const BASE = new URL('.', document.baseURI).href;
/** Real milliseconds between autosaves. */
const AUTOSAVE_MS = 30_000;

function Root() {
  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<Game | null>(null);

  useEffect(() => {
    loadWorld(new URL('data/', BASE).href).then(
      (w) => {
        setWorld(w);
        preloadCity(BASE, window.location.search, w);
      },
      (e: unknown) => setError(String(e)),
    );
  }, []);

  useEffect(() => {
    if (!game) return;
    const save = () => saveGame(game);
    const timer = setInterval(save, AUTOSAVE_MS);
    const onHide = () => document.visibilityState === 'hidden' && save();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', save);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', save);
    };
  }, [game]);

  const start = useCallback(
    (g: Game) => {
      installSystems(g);
      // Dev builds expose the game for console debugging and automated play-testing.
      if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = g;
      setGame(g);
    },
    [],
  );

  if (error) return <div className="loading">Could not load the map of Chiang Mai: {error}</div>;
  if (!world) return <div className="loading"><div className="spinner">🛺</div>Loading Chiang Mai…</div>;
  if (!game) {
    return (
      <TitleScreen
        onNew={(opts) => {
          deleteSave();
          start(Game.create(world, opts));
        }}
        onContinue={() => {
          const g = loadGame(world);
          if (g) start(g);
        }}
      />
    );
  }
  return (
    <App
      game={game}
      base={BASE}
      onSave={() => {
        if (saveGame(game)) game.notify('Game saved.', 'info');
      }}
      onQuit={() => {
        saveGame(game);
        setGame(null);
      }}
    />
  );
}

// A hot update can run this module again: it renders into the root already mounted on the element.
const container = document.getElementById('root') as HTMLElement & { reactRoot?: ReactRoot };
(container.reactRoot ??= createRoot(container)).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
