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
            containerRef.current.innerHTML = svg;

            // Apply text colors after render based on element context
            setTimeout(() => {
              if (containerRef.current) {
                // Cluster/subgraph labels are on light pastel backgrounds - always use dark text
                const clusterLabels = containerRef.current.querySelectorAll('.cluster-label');
                clusterLabels.forEach((el) => {
                  const textEl = el.querySelector('text, tspan');
                  if (textEl) {
                    (textEl as SVGElement).setAttribute('fill', '#1a1a1a');
                  }
                  const htmlEl = el.querySelector('p, span, div');
                  if (htmlEl) {
                    (htmlEl as HTMLElement).style.color = '#1a1a1a';
                    (htmlEl as HTMLElement).style.fontWeight = '600';
                  }
                });

                // Also handle cluster labels in foreignObject format
                const clusterForeignObjects = containerRef.current.querySelectorAll('.cluster foreignObject');
                clusterForeignObjects.forEach((fo) => {
                  const htmlEls = fo.querySelectorAll('p, span, div');
                  htmlEls.forEach((el) => {
                    (el as HTMLElement).style.color = '#1a1a1a';
                    (el as HTMLElement).style.fontWeight = '600';
                  });
                });

                // Node labels are on darker backgrounds - use white text
                const nodeLabels = containerRef.current.querySelectorAll('.node .label');
                nodeLabels.forEach((el) => {
                  const textEl = el.querySelector('text, tspan');
                  if (textEl) {
                    (textEl as SVGElement).setAttribute('fill', '#ffffff');
                  }
                  const htmlEl = el.querySelector('p, span, div');
                  if (htmlEl) {
                    (htmlEl as HTMLElement).style.color = '#ffffff';
                    (htmlEl as HTMLElement).style.fontWeight = '600';
                  }
                });

                // Handle node foreignObjects directly
                const nodeForeignObjects = containerRef.current.querySelectorAll('.node foreignObject');
                nodeForeignObjects.forEach((fo) => {
                  const htmlEls = fo.querySelectorAll('p, span, div');
                  htmlEls.forEach((el) => {
                    (el as HTMLElement).style.color = '#ffffff';
                    (el as HTMLElement).style.fontWeight = '600';
                  });
                });

                // Edge labels should be theme-aware (on transparent/page background)
                const edgeLabels = containerRef.current.querySelectorAll('.edgeLabel');
                edgeLabels.forEach((el) => {
                  const isDark = document.documentElement.classList.contains('dark');
                  const color = isDark ? '#ffffff' : '#1a1a1a';
                  const textEl = el.querySelector('text, tspan');
                  if (textEl) {
                    (textEl as SVGElement).setAttribute('fill', color);
                  }
                  const htmlEl = el.querySelector('p, span, div');
                  if (htmlEl) {
                    (htmlEl as HTMLElement).style.color = color;
                  }
                });
              }
            }, 0);
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
