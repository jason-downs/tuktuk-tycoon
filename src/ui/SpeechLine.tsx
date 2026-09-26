import { glossLine, isNarration, lineText } from '../content/dialogue';
import './speech.css';

/**
 * Text with Thai and Kham Mueang words underlined; hovering or tapping one
 * shows its translation. Place names passed in `protect` are never glossed.
 */
export function GlossedText({ text, protect = [] }: { text: string; protect?: readonly string[] }) {
  return (
    <>
      {glossLine(text, protect).map((s, i) =>
        s.gloss ? (
          <span key={i} className="gloss" tabIndex={0} data-gloss={s.gloss}>
            {s.text}
            <span className="sr-only"> ({s.gloss})</span>
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** A passenger's line: speech in quotes, or narration (a monk's silence) in italics. */
export function SpeechLine({
  line,
  protect,
  className = 'quote-line',
  quotes = true,
}: {
  line: string;
  protect?: readonly string[];
  className?: string;
  quotes?: boolean;
}) {
  const narration = isNarration(line);
  const text = lineText(line);
  return (
    <div className={`${className} ${narration ? 'narration' : ''}`}>
      {quotes && !narration && '“'}
      <GlossedText text={text} protect={protect} />
      {quotes && !narration && '”'}
    </div>
  );
}
