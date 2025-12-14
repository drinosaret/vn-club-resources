'use client';

import { useMemo } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ResourceSection } from './ResourceSection';
import { RelatedPages } from './RelatedPages';
import { parseResourceContent } from '@/lib/resource-parser';

interface ResourceMarkdownRendererProps {
  content: string;
}

export function ResourceMarkdownRenderer({ content }: ResourceMarkdownRendererProps) {
  const blocks = useMemo(() => parseResourceContent(content), [content]);

  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        if (block.type === 'resource-section') {
          return <ResourceSection key={index} section={block.section} />;
        }

        if (block.type === 'related-pages') {
          return <RelatedPages key={index} categories={block.categories} />;
        }

        // Delegate non-resource content to standard MarkdownRenderer
        return (
          <div key={index}>
            <MarkdownRenderer content={block.content} />
          </div>
        );
      })}
    </div>
  );
}
