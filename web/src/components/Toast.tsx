export function Toast({ toast }: { toast: { text: string; link?: string } }) {
  return (
    <div className="fixed bottom-4 right-4 surface rounded-lg shadow-elevated text-sm px-4 py-2.5 max-w-sm animate-[fadeIn_120ms_ease-out]">
      {toast.link ? (
        <a
          href={toast.link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-primary hover:text-accent inline-flex items-center gap-1.5"
        >
          <span>{toast.text}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0">
            <path d="M14 3h7v7" />
            <path d="M10 14L21 3" />
            <path d="M21 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h6" />
          </svg>
        </a>
      ) : (
        toast.text
      )}
    </div>
  );
}
