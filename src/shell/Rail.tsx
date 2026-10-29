import { RAIL, SECTIONS, type SectionId } from "./sections";

interface RailProps {
  current: SectionId;
  onSelect: (id: SectionId) => void;
}

export function Rail({ current, onSelect }: RailProps) {
  return (
    <nav className="rail solid" aria-label="App sections">
      {RAIL.map((item, i) => {
        if (item === null) return <span key={i} className="rsep" aria-hidden="true" />;
        if (item === "spacer") return <span key={i} className="sp" />;
        const section = SECTIONS[item];
        return (
          <button
            key={item}
            type="button"
            aria-current={item === current ? "page" : undefined}
            onClick={() => onSelect(item)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={section.icon} />
            </svg>
            <span>{section.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
