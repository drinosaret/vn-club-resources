import { Components } from 'react-markdown';
import { Children, ReactNode, isValidElement } from 'react';
import { MermaidDiagram } from './MermaidDiagram';
import { Callout } from './Callout';
import { CodeBlock } from './CodeBlock';
import { ImageLightbox } from './ImageLightbox';
import { generateHeadingId } from '@/lib/slug-utils';

// Helper function to extract text from React children
const getTextFromChildren = (children: ReactNode): string => {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string') return child;
      if (typeof child === 'number') return String(child);
      if (isValidElement(child) && child.props.children) {
        return getTextFromChildren(child.props.children);
      }
      return '';
    })
    .join('');
};

// Helper function to generate heading IDs from React children
const generateId = (children: ReactNode) => {
  const text = getTextFromChildren(children);
  return generateHeadingId(text);
};

export const markdownComponents: Components = {
  // Headings with auto-generated IDs
  h1: ({ children, ...props }) => {
    const id = generateId(children);
    return (
      <h1 id={id} className="text-3xl font-bold mb-6" {...props}>
        {children}
      </h1>
    );
  },
  h2: ({ children, ...props }) => {
    const id = generateId(children);
    return (
      <h2 id={id} className="text-2xl font-bold mt-12 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700" {...props}>
        {children}
      </h2>
    );
  },
  h3: ({ children, ...props }) => {
    const id = generateId(children);
    return (
      <h3 id={id} className="text-xl font-semibold mt-8 mb-3" {...props}>
        {children}
      </h3>
    );
  },
  h4: ({ children, ...props }) => {
    const id = generateId(children);
    return (
      <h4 id={id} className="text-lg font-semibold mt-6 mb-2" {...props}>
        {children}
      </h4>
    );
  },

  // Paragraphs
  p: ({ children }) => {
    return <p className="my-4 leading-relaxed">{children}</p>;
  },

  // Horizontal rule - clean divider
  hr: () => {
    return <hr className="my-8 border-0 border-t border-gray-200 dark:border-gray-700" />;
  },

  // Images with lightbox support
  img: (props) => {
    const src = props.src || '';
    const alt = props.alt || '';
    const hasInlineStyle = props.style && Object.keys(props.style).length > 0;

    // If inline styles are provided (from raw HTML), use a plain img and respect them
    if (hasInlineStyle) {
      return (
        <ImageLightbox src={src} alt={alt}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="rounded-lg shadow-sm mx-auto my-6"
            style={props.style}
          />
        </ImageLightbox>
      );
    }

    // External images - use aspect-ratio container to prevent layout shift
    if (src.startsWith('http')) {
      return (
        <ImageLightbox src={src} alt={alt}>
          <span
            className="block my-6 mx-auto bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden"
            style={{
              maxWidth: '600px',
              aspectRatio: '4/3',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              className="rounded-lg shadow-sm w-full h-full object-contain"
              loading="lazy"
              onLoad={(e) => {
                // Once loaded, adjust container to actual aspect ratio
                const img = e.target as HTMLImageElement;
                const container = img.parentElement;
                if (container && img.naturalWidth && img.naturalHeight) {
                  container.style.aspectRatio = `${img.naturalWidth}/${img.naturalHeight}`;
                }
              }}
            />
          </span>
        </ImageLightbox>
      );
    }

    // Local images - use native img to avoid Next.js Image warnings about aspect ratio
    return (
      <ImageLightbox src={src} alt={alt}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="rounded-lg shadow-sm mx-auto my-6"
          style={{ maxWidth: '600px', width: '100%', height: 'auto' }}
          loading="lazy"
        />
      </ImageLightbox>
    );
  },

  // Blockquotes - Modern callout style
  blockquote: (props) => {
    return <Callout>{props.children}</Callout>;
  },

  // Tables
  table: (props) => {
    return (
      <div className="overflow-x-auto my-6 rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          {props.children}
        </table>
      </div>
    );
  },

  thead: (props) => {
    return (
      <thead className="bg-gray-50 dark:bg-gray-800">
        {props.children}
      </thead>
    );
  },

  tbody: (props) => {
    return (
      <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
        {props.children}
      </tbody>
    );
  },

  th: (props) => {
    return (
      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
        {props.children}
      </th>
    );
  },

  td: (props) => {
    return (
      <td className="px-4 py-3 text-sm">
        {props.children}
      </td>
    );
  },

  // Lists
  ul: (props) => {
    return (
      <ul className="my-4 ml-4 space-y-2 list-disc list-outside">
        {props.children}
      </ul>
    );
  },

  ol: (props) => {
    return (
      <ol className="my-4 ml-4 space-y-2 list-decimal list-outside">
        {props.children}
      </ol>
    );
  },

  li: (props) => {
    return (
      <li className="pl-1">
        {props.children}
      </li>
    );
  },

  // Links
  a: ({ href, children }) => {
    const isExternal = href?.startsWith('http');
    return (
      <a
        href={href}
        className="text-indigo-600 dark:text-indigo-400 hover:underline"
        {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {children}
      </a>
    );
  },

  // Strong/Bold
  strong: ({ children }) => {
    return <strong className="font-semibold">{children}</strong>;
  },

  // Code
  code: ({ className, ...props }) => {
    // Mermaid diagrams
    if (className === 'language-mermaid') {
      const code = String(props.children).replace(/\n$/, '');
      return <MermaidDiagram chart={code} />;
    }

    // Inline code
    const isInline = !className || !className.startsWith('language-');

    if (isInline) {
      return (
        <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono text-pink-600 dark:text-pink-400 break-all">
          {props.children}
        </code>
      );
    }

    return (
      <code className={className}>
        {props.children}
      </code>
    );
  },

  pre: (props) => {
    return <CodeBlock>{props.children}</CodeBlock>;
  },
};
