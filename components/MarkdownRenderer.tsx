'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { markdownComponents } from './MarkdownComponents';
import { AdmonitionBlock } from './AdmonitionBlock';

// Custom sanitization schema that allows safe HTML while blocking XSS
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // Allow class attributes for styling
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'class'],
    // Allow target and rel on links for external links
    a: [...(defaultSchema.attributes?.a || []), 'target', 'rel'],
    // Allow src, alt, and sizing on images (content is from our own MDX files)
    img: [...(defaultSchema.attributes?.img || []), 'src', 'alt', 'loading', 'width', 'height', 'style'],
  },
  // Block dangerous protocols
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
  },
};

interface ContentBlock {
  type: 'markdown' | 'admonition';
  content: string;
  admonitionType?: string;
  admonitionTitle?: string;
}

function parseContent(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  // Support both LF and CRLF line endings
  const admonitionRegex = /^!!! (\w+)(?: "([^"]*)")?\s*\r?\n((?:(?:[ ]{4}.*|[ ]*)\r?\n)*)/gm;

  let lastIndex = 0;
  let match;

  while ((match = admonitionRegex.exec(content)) !== null) {
    // Add markdown content before this admonition
    if (match.index > lastIndex) {
      const markdownContent = content.slice(lastIndex, match.index).trim();
      if (markdownContent) {
        blocks.push({ type: 'markdown', content: markdownContent });
      }
    }

    // Add the admonition
    const [, type, title, body] = match;
    const cleanBody = body
      .split(/\r?\n/)
      .map((line: string) => line.replace(/^[ ]{4}/, ''))
      .join('\n')
      .trim();

    blocks.push({
      type: 'admonition',
      content: cleanBody,
      admonitionType: type.toLowerCase(),
      admonitionTitle: title,
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining markdown content
  if (lastIndex < content.length) {
    const remainingContent = content.slice(lastIndex).trim();
    if (remainingContent) {
      blocks.push({ type: 'markdown', content: remainingContent });
    }
  }

  return blocks;
}

// Clean up MkDocs-specific syntax
function cleanMarkdown(content: string): string {
  return content
    // Remove image attributes
    .replace(/!\[([^\]]*)\]\(([^)]+)\)\{:\s*style="[^"]*"\s*\}/g, '![$1]($2)')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)\{\s*width\s*=\s*\d+\s*\}/g, '![$1]($2)')
    // Remove alignment syntax
    .replace(/^\{ align=center \}\s*$/gm, '')
    // Remove centered divs but keep content
    .replace(/<div align="center">\s*([\s\S]*?)\s*<\/div>/gi, '\n$1\n')
    // Convert relative asset paths to absolute (fixes trailingSlash navigation)
    .replace(/!\[([^\]]*)\]\(assets\//g, '![$1](/assets/')
    .replace(/src="assets\//g, 'src="/assets/');
}

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  // Memoize expensive parsing operations to prevent re-computation during scroll
  const blocks = useMemo(() => {
    const cleanedContent = cleanMarkdown(content);
    return parseContent(cleanedContent);
  }, [content]);

  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        if (block.type === 'admonition') {
          return (
            <div key={index} className="my-6">
              <AdmonitionBlock
                type={block.admonitionType || 'info'}
                title={block.admonitionTitle}
              >
                {block.content}
              </AdmonitionBlock>
            </div>
          );
        }

        return (
          <div key={index}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
              components={markdownComponents}
            >
              {block.content}
            </ReactMarkdown>
          </div>
        );
      })}
    </div>
  );
}
