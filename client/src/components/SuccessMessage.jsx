import React from 'react';

export default function SuccessMessage({ message }) {
  if (!message) return null;
  return <div className="success-banner">{message}</div>;
}
