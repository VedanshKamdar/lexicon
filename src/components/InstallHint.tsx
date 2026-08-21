import { useEffect, useState } from 'react';

const DISMISSED_KEY = 'lexicon:installDismissed';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS predates the display-mode media query and uses its own flag.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS 13+ reports itself as a Mac, but a Mac has no touch points.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Installing matters more here than for a typical PWA: iOS Safari evicts
 * IndexedDB for ordinary websites after about a week of disuse, while installed
 * home-screen apps are exempt. An uninstalled Lexicon can silently lose the
 * entire vocabulary book.
 *
 * Chrome and Edge fire beforeinstallprompt so we can offer a real button. Safari
 * fires nothing at all, so iOS gets instructions instead.
 */
export function InstallHint() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === '1'
  );
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || dismissed) return null;

  const ios = isIOS();
  if (!ios && !prompt) return null;

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  }

  return (
    <div className="mt-6 rounded-lg border border-rule bg-surface px-3.5 py-3">
      <p className="text-[13px] leading-snug text-ink">
        Add Lexicon to your home screen
      </p>
      <p className="mt-1 text-[12px] leading-snug text-ink-2">
        {ios
          ? 'Tap the Share button, then “Add to Home Screen”. Installed, your saved words work offline and stay put — Safari clears storage for uninstalled sites.'
          : 'Installed, your saved words work offline and load instantly.'}
      </p>
      <div className="mt-2.5 flex gap-3">
        {!ios && prompt && (
          <button
            onClick={() => {
              void prompt.prompt();
              setPrompt(null);
            }}
            className="rounded-md border border-rule px-3 py-1.5 text-[12px] text-ink transition-colors hover:bg-soft"
          >
            Install
          </button>
        )}
        <button onClick={dismiss} className="text-[12px] text-ink-3 hover:text-ink">
          Not now
        </button>
      </div>
    </div>
  );
}
