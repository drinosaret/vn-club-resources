import { Components } from 'react-markdown';
import { Children, ReactNode, isValidElement } from 'react';
import { Link } from 'lucide-react';
import { Callout } from './Callout';
import { CodeBlock } from './CodeBlock';
import { ImageLightbox } from './ImageLightbox';
import { LazyImage } from './LazyImage';
import { generateHeadingId } from '@/lib/slug-utils';

// Helper function to extract text from React children
const getTextFromChildren = (children: ReactNode): string => {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string') return child;
      if (typeof child === 'number') return String(child);
      if (isValidElement<{ children?: ReactNode }>(child) && child.props.children) {
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
      <h1 id={id} className="group font-display text-3xl font-bold mb-6 text-[color:var(--ink)]" {...props}>
        {children}
        <a
          href={`#${id}`}
          className="md-anchor"
          title="Permanent link"
          aria-label="Link to this section"
        >
          <Link className="inline h-4 w-4" />
        </a>
      </h1>
    );
  },
  h2: ({ children, ...props }) => {
    const id = generateId(children);
    return (
      <h2 id={id} className="group font-display text-2xl font-bold mt-12 mb-4 pb-2 border-b border-[color:var(--rule)] text-[color:var(--ink)]" {...props}>
        {children}
        <a
          href={`#${id}`}
          className="md-anchor"
          title="Permanent link"
          aria-label="Link to this section"
        >
          <Link className="inline h-4 w-4" />
        </a>
      </h2>
    );
  },
  h3: ({ children, ...props }) => {
    const id = generateId(children);
    return (
      <h3 id={id} className="group font-display text-xl font-semibold mt-8 mb-3 text-[color:var(--ink)]" {...props}>
        {children}
        <a
          href={`#${id}`}
          className="md-anchor"
          title="Permanent link"
          aria-label="Link to this section"
        >
          <Link className="inline h-4 w-4" />
        </a>
      </h3>
    );
  },
  h4: ({ children, ...props }) => {
    const id = generateId(children);
    return (
      <h4 id={id} className="group font-display text-lg font-semibold mt-6 mb-2 text-[color:var(--ink)]" {...props}>
        {children}
        <a
          href={`#${id}`}
          className="md-anchor"
          title="Permanent link"
          aria-label="Link to this section"
        >
          <Link className="inline h-3.5 w-3.5" />
        </a>
      </h4>
    );
  },

  // Paragraphs - render as <div> when containing block-level elements (images)
  // to avoid invalid <div> inside <p> nesting from ImageLightbox
  p: ({ children, node }) => {
    const hasImage = node?.children?.some(
      (child) => 'tagName' in child && child.tagName === 'img'
    );
    if (hasImage) {
      return <div className="my-4 leading-relaxed">{children}</div>;
    }
    return <p className="my-4 leading-relaxed text-[color:var(--text-secondary)]">{children}</p>;
  },

  // Horizontal rule - clean divider
  hr: () => {
    return <hr className="my-8 border-0 border-t border-[color:var(--rule)]" />;
  },

  // Images with lightbox support and lazy loading
  img: (props) => {
    const src = String(props.src || '');
    const alt = String(props.alt || '');
    const hasInlineStyle = props.style && Object.keys(props.style).length > 0;

    // If inline styles are provided (from raw HTML), render a plain img
    // without ImageLightbox wrapper to preserve parent flex/grid layouts
    if (hasInlineStyle) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="rounded-xs mx-auto"
          decoding="async"
          style={props.style}
        />
      );
    }

    // Use LazyImage for proper loading state handling
    return (
      <LazyImage
        src={src}
        alt={alt}
        className="rounded-xs mx-auto my-4"
        style={{ maxWidth: '600px', width: '100%' }}
      />
    );
  },

  // Blockquotes - Modern callout style
  blockquote: (props) => {
    return <Callout>{props.children}</Callout>;
  },

  // Tables
  table: (props) => {
    return (
      <div className="overflow-x-auto my-6 rounded-xs border border-[color:var(--rule)]">
        <table className="min-w-full">
          {props.children}
        </table>
      </div>
    );
  },

  // The rule under the header is what separates it from the rows, so it carries no fill.
  thead: (props) => {
    return (
      <thead className="border-b border-[color:var(--rule)]">
        {props.children}
      </thead>
    );
  },

  tbody: (props) => {
    return (
      <tbody className="divide-y divide-[color:var(--rule)]">
        {props.children}
      </tbody>
    );
  },

  th: (props) => {
    return (
      <th className="px-4 py-3 text-left font-mono text-xs font-medium uppercase tracking-wider text-[color:var(--nezu)]">
        {props.children}
      </th>
    );
  },

  td: (props) => {
    return (
      <td className="px-4 py-3 text-sm text-[color:var(--text-secondary)]">
        {props.children}
      </td>
    );
  },

  // Lists
  ul: (props) => {
    return (
      <ul className="my-4 ml-4 space-y-2 list-disc list-outside text-[color:var(--text-secondary)]">
        {props.children}
      </ul>
    );
  },

  ol: (props) => {
    return (
      <ol className="my-4 ml-4 space-y-2 list-decimal list-outside text-[color:var(--text-secondary)]">
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
        className="text-[color:var(--ai)] hover:underline"
        {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {children}
      </a>
    );
  },

  // Strong/Bold
  strong: ({ children }) => {
    return <strong className="font-semibold text-[color:var(--ink)]">{children}</strong>;
  },

  // Code
  code: ({ className, ...props }) => {
    // Inline code
    const isInline = !className || !className.startsWith('language-');

    if (isInline) {
      return (
        <code className="bg-[color:var(--surface-inset)] px-1.5 py-0.5 rounded-xs text-sm font-mono text-[color:var(--beni-text)] break-all">
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
