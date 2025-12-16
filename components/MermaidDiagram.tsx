'use client';

import { useEffect, useRef, memo } from 'react';

interface MermaidDiagramProps {
  chart: string;
}

export const MermaidDiagram = memo(function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const renderDiagram = async () => {
      if (containerRef.current) {
        try {
          // Dynamically import mermaid only on client side
          const mermaid = (await import('mermaid')).default;

          mermaid.initialize({
            startOnLoad: false,
            theme: 'neutral',
            securityLevel: 'loose',
            flowchart: {
              htmlLabels: true,
              curve: 'basis',
            },
          });

          const { svg } = await mermaid.render(`mermaid-${Date.now()}`, chart);
          if (containerRef.current) {
            // Insert SVG - text colors are handled by CSS in globals.css
            // This avoids expensive DOM manipulation and reflows
            containerRef.current.innerHTML = svg;
          }
        } catch (error) {
          console.error('Failed to render mermaid diagram:', error);
          if (containerRef.current) {
            containerRef.current.innerHTML = '<p class="text-red-500">Failed to render diagram</p>';
          }
        }
      }
    };

    renderDiagram();
  }, [chart]);

  // This component serves as a fallback for any content that isn't pre-processed
  return (
    <div
      ref={containerRef}
      className="my-6 flex justify-center mermaid-diagram"
    />
  );
});
