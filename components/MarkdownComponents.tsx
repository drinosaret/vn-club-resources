import Image from 'next/image';
import { Components } from 'react-markdown';
import { MermaidDiagram } from './MermaidDiagram';
import { Callout } from './Callout';
import { CodeBlock } from './CodeBlock';
import { ImageLightbox } from './ImageLightbox';

// Helper function to generate heading IDs
const generateId = (text: string) => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
};

export const markdownComponents: Components = {
  // Headings with auto-generated IDs
  h1: ({ children, ...props }) => {
    const text = String(children);
    const id = generateId(text);
    return (
      <h1 id={id} className="text-3xl font-bold mb-6" {...props}>
        {children}
      </h1>
    );
  },
  h2: ({ children, ...props }) => {
    const text = String(children);
    const id = generateId(text);
    return (
      <h2 id={id} className="text-2xl font-bold mt-12 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700" {...props}>
        {children}
      </h2>
    );
  },
  h3: ({ children, ...props }) => {
    const text = String(children);
    const id = generateId(text);
    return (
      <h3 id={id} className="text-xl font-semibold mt-8 mb-3" {...props}>
        {children}
      </h3>
    );
  },
  h4: ({ children, ...props }) => {
    const text = String(children);
    const id = generateId(text);
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

    if (src.startsWith('http')) {
      return (
        <ImageLightbox src={src} alt={alt}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            {...props}
            alt={alt}
            className="rounded-lg shadow-sm mx-auto my-6 max-w-full"
            style={{ maxWidth: '600px', height: 'auto', display: 'block' }}
          />
        </ImageLightbox>
      );
    }

    return (
      <ImageLightbox src={src} alt={alt}>
        <span className="block my-6 mx-auto" style={{ maxWidth: '600px' }}>
          <Image
            src={src}
            alt={alt}
            width={600}
            height={450}
            className="rounded-lg shadow-sm"
            style={{ width: '100%', height: 'auto' }}
          />
        </span>
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
        <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono text-pink-600 dark:text-pink-400">
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
