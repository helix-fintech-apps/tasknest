/** First focusable element on every page: jumps past the navigation to <main id="main">. */
export function SkipLink() {
  return (
    <a
      href="#main"
      data-testid="skip-link"
      className="sr-only rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]"
      onClick={(e) => {
        e.preventDefault();
        const m = document.getElementById("main");
        m?.focus();
        m?.scrollIntoView();
      }}
    >
      Skip to content
    </a>
  );
}
