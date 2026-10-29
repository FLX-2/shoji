import { useState } from "react";

interface MoneyRowProps {
  id: string;
  label: string;
  description: string;
  value: number;
  onChange: (dollars: number) => void;
}

/** A setting in dollars. The field keeps what's typed, so "0.0" can become "0.05"; only a positive amount is saved. */
export function MoneyRow({ id, label, description, value, onChange }: MoneyRowProps) {
  const [typed, setTyped] = useState(String(value));
  return (
    <div className="srow">
      <label htmlFor={id}>
        <b>{label}</b>
        <span className="d">{description}</span>
      </label>
      <div className="money">
        <span aria-hidden="true">$</span>
        <input
          id={id}
          type="number"
          min={0.01}
          step={value >= 5 ? 5 : 0.05}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            if (Number(e.target.value) > 0) onChange(Number(e.target.value));
          }}
          onBlur={() => setTyped(String(value))}
        />
      </div>
    </div>
  );
}
