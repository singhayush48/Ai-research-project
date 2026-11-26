import React from 'react';
import { Menu } from 'lucide-react';

export default function Topbar({ onMenuClick, title = '' }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="topbar-menu-btn" onClick={onMenuClick} aria-label="Open menu">
          <Menu />
        </button>
        {title && <div className="topbar-title">{title}</div>}
      </div>
    </header>
  );
}
