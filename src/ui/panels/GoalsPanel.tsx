import { GOALS, GOAL_CHAPTERS, type GoalDef } from '../../content/goals';
import type { Game } from '../../sim/game';
import { goalProgress, goalTrack, isComplete } from '../../sim/goals';
import type { PanelProps } from '../panels';
import { baht } from '../format';
import { useGame } from '../store';
import './goals.css';

/** Open goals listed under "Next up". */
const NEXT_UP = 3;

function Reward({ goal }: { goal: GoalDef }) {
  const { cash, reviews } = goal.reward;
  return (
    <span className="goal-reward" title={`Reward: ${baht(cash)}${reviews ? ` and ${reviews} five-star review${reviews === 1 ? '' : 's'}` : ''}`}>
      +{baht(cash)}
      {reviews ? ` · ★×${reviews}` : ''}
    </span>
  );
}

function GoalRow({ game, goal, big }: { game: Game; goal: GoalDef; big?: boolean }) {
  const done = isComplete(game, goal.id);
  const p = goalProgress(game, goal);
  return (
    <li className={`goal ${done ? 'done' : ''} ${big ? 'big' : ''}`}>
      <span className="goal-icon" aria-hidden>
        {done ? '✓' : goal.icon}
      </span>
      <div className="goal-main">
        <div className="goal-title">
          <b>{goal.title}</b>
          <Reward goal={goal} />
        </div>
        {!done && <div className="goal-desc">{goal.desc}</div>}
        {!done && (
          <div className="goal-progress">
            <span className="goal-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} aria-label={goal.title}>
              <span className="goal-fill" style={{ width: `${p * 100}%` }} />
            </span>
            <span className="goal-detail">{goal.detail(game, goalTrack(game))}</span>
          </div>
        )}
      </div>
    </li>
  );
}

export function GoalsPanel({ game }: PanelProps) {
  // Re-render every 10 game seconds (the goal check interval) and when a goal completes.
  useGame(game, (g) => `${Math.floor(g.state.time / 10)}|${g.state.goals.length}`);
  const done = GOALS.filter((g) => isComplete(game, g.id));
  const open = GOALS.filter((g) => !isComplete(game, g.id));
  const next = [...open].sort((a, b) => a.chapter - b.chapter || goalProgress(game, b) - goalProgress(game, a)).slice(0, NEXT_UP);
  const earned = done.reduce((sum, g) => sum + g.reward.cash, 0);
  return (
    <div className="goals">
      <section className="goals-summary">
        <div>
          <span className="eyebrow">Goals reached</span>
          <div className="goals-count">
            {done.length} <span className="muted">/ {GOALS.length}</span>
          </div>
        </div>
        <div className="goals-earned">
          <span className="eyebrow">Rewards collected</span>
          <b>{baht(earned)}</b>
        </div>
        <span className="goal-track wide">
          <span className="goal-fill" style={{ width: `${(done.length / GOALS.length) * 100}%` }} />
        </span>
      </section>

      {next.length > 0 && (
        <section>
          <div className="eyebrow">Next up</div>
          <ul className="goal-list">
            {next.map((g) => (
              <GoalRow key={g.id} game={game} goal={g} big />
            ))}
          </ul>
        </section>
      )}

      {GOAL_CHAPTERS.map((title, chapter) => {
        const goals = GOALS.filter((g) => g.chapter === chapter);
        const n = goals.filter((g) => isComplete(game, g.id)).length;
        return (
          <section key={title}>
            <div className="goals-chapter">
              <span className="eyebrow">
                {chapter + 1}. {title}
              </span>
              <span className="small muted">
                {n} / {goals.length}
              </span>
            </div>
            <ul className="goal-list">
              {goals.map((g) => (
                <GoalRow key={g.id} game={game} goal={g} />
              ))}
            </ul>
          </section>
        );
      })}
      <p className="hint small">Rewards are paid into the ledger as “Other” income; five-star reviews lift the company rating.</p>
    </div>
  );
}
