import { useMemo, useState } from 'react';
import { TIPS } from '../content/tips';
import type { NewGameOptions } from '../sim/game';
import { formatDate } from '../sim/clock';
import { readSaveInfo } from '../save';
import { baht } from './format';

export function TitleScreen({ onNew, onContinue }: { onNew: (o: NewGameOptions) => void; onContinue: () => void }) {
  const save = useMemo(readSaveInfo, []);
  const tip = useMemo(() => TIPS[Math.floor(Math.random() * TIPS.length)], []);
  const [name, setName] = useState('Somchai');
  const [company, setCompany] = useState('Lucky Tuk-Tuk Co.');
  return (
    <div className="title-screen">
      <div className="title-card">
        <div className="title-art">
          <span className="sun" />
          <span className="doi" />
          <span className="chedi">🛕</span>
          <span className="tt">🛺</span>
        </div>
        <h1>
          Tuk-Tuk Tycoon
          <small>Chiang Mai · เชียงใหม่</small>
        </h1>
        <p className="lede">
          Start with one rented tuk-tuk at Tha Phae Gate. Haggle fares, learn the one-way moat, hire drivers and grow
          the biggest tuk-tuk company in Lanna — on a street-accurate map of Chiang Mai.
        </p>
        <div className="form">
          <label>
            Your nickname
            <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Company name
            <input value={company} maxLength={32} onChange={(e) => setCompany(e.target.value)} />
          </label>
        </div>
        <div className="row center">
          <button className="btn primary big" onClick={() => onNew({ playerName: name.trim() || 'You', companyName: company.trim() || 'Lucky Tuk-Tuk Co.' })}>
            New game
          </button>
          {save && (
            <button className="btn big" onClick={onContinue}>
              Continue — {save.company}, {formatDate(save.time)}, {baht(save.cash)}
            </button>
          )}
        </div>
        <p className="tip">💡 {tip}</p>
        <p className="credits">
          Map data © OpenStreetMap contributors (ODbL). Fares, costs, festivals and places researched from public
          sources — see docs/research.
        </p>
      </div>
    </div>
  );
}
