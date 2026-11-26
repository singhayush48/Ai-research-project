import React, { useState } from 'react';
import { Sparkles, AlertCircle } from 'lucide-react';
import { api } from '../services/api.js';

export default function Register({ onRegistered, onSwitchToLogin }) {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.register(form);
      onRegistered(data.user);
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
        <p className="auth-subtitle">Create an account to start a research project.</p>

        {error && (
          <div className="error-banner" role="alert">
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              {error}
            </span>
          </div>
        )}

        <label className="field-label">Full Name</label>
        <input
          className="field-input"
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Ayush Singh"
        />

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
          minLength={8}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder="At least 8 characters"
        />

        <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
          {loading ? 'Creating account...' : 'Create Account'}
        </button>

        <p className="auth-switch">
          Already have an account?{' '}
          <button type="button" className="link-button" onClick={onSwitchToLogin}>
            Sign in
          </button>
        </p>
      </form>
    </div>
  );
}
