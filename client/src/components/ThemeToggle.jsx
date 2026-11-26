import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

export default function ThemeToggle({ theme, setTheme }) {
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          className={`theme-toggle-option ${theme === value ? 'active' : ''}`}
          onClick={() => setTheme(value)}
          title={label}
        >
          <Icon aria-hidden="true" />
          <span className="theme-toggle-label">{label}</span>
        </button>
      ))}
    </div>
  );
}
