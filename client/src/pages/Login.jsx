import React, { useState } from 'react';
import { Sparkles, AlertCircle } from 'lucide-react';
import { api } from '../services/api.js';

export default function Login({ onLoggedIn, onSwitchToRegister }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.login(form);
      onLoggedIn(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand">
          <span className="brand-mark">
            <Sparkles strokeWidth={2.25} />
          </span>
          <h1>Research Assistant</h1>
        </div>
        <p className="auth-subtitle">Sign in to continue your research.</p>

        {error && (
          <div className="error-banner" role="alert">
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              {error}
            </span>
          </div>
        )}

        <label className="field-label">Email</label>
        <input
          className="field-input"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="you@university.edu"
        />

        <label className="field-label">Password</label>
        <input
          className="field-input"
          type="password"
          required
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder="********"
        />

        <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

        <p className="auth-switch">
          Don't have an account?{' '}
          <button type="button" className="link-button" onClick={onSwitchToRegister}>
            Create one
          </button>
        </p>
      </form>
    </div>
  );
}
