'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { markdownComponents } from './MarkdownComponents';
import { AdmonitionBlock } from './AdmonitionBlock';

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
    .replace(/<div align="center">\s*([\s\S]*?)\s*<\/div>/gi, '\n$1\n');
}

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const cleanedContent = cleanMarkdown(content);
  const blocks = parseContent(cleanedContent);

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
              rehypePlugins={[rehypeRaw]}
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
