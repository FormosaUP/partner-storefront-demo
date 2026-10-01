'use client';

// Last line of defence: an unexpected value from the API must never leave a blank page.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="state-page" role="alert">
      <p className="eyebrow">Something broke</p>
      <h1>This page ran into a problem.</h1>
      <p>Your cart is saved on this device. Reloading usually fixes it.</p>
      <div className="state-page__actions">
        <button type="button" className="btn btn--primary" onClick={reset}>
          Try again
        </button>
        <a className="btn btn--ghost" href="./">
          Reload the menu
        </a>
      </div>
    </main>
  );
}
