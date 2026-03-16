import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

let mermaidInitialized = false;

function initMermaid() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      darkMode: true,
      background: '#1e1e22',
      primaryColor: '#7c1fff',
      primaryTextColor: '#e6e6e8',
      primaryBorderColor: '#4d4d54',
      lineColor: '#6b6b74',
      secondaryColor: '#2a2a2f',
      tertiaryColor: '#18181b',
    },
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  });
  mermaidInitialized = true;
}

interface MermaidDiagramProps {
  chart: string;
}

function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 11)}`);

  useEffect(() => {
    if (!containerRef.current) return;

    initMermaid();
    setError(null);

    const el = containerRef.current;
    el.innerHTML = '';

    mermaid
      .render(idRef.current, chart)
      .then(({ svg }) => {
        el.innerHTML = svg;
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Failed to render diagram';
        setError(msg);
      });
  }, [chart]);

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-red-400">Diagram rendering failed</p>
        <pre className="text-xs text-dark-400 bg-dark-900 p-3 rounded overflow-auto max-h-48">
          {chart}
        </pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="overflow-auto rounded bg-dark-900 p-2 [&_svg]:max-w-full"
    />
  );
}

export default MermaidDiagram;
