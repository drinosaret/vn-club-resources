import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

interface SearchDocument {
  id: string;
  slug: string;
  title: string;
  content: string;
  description?: string;
  section?: string;
  type: 'guide';
}

const CONTENT_DIR = path.join(process.cwd(), 'content');
const OUTPUT_PATH = path.join(process.cwd(), 'public', 'search-index.json');

function stripMarkdown(text: string): string {
  return text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove inline code
    .replace(/`[^`]*`/g, '')
    // Remove images
    .replace(/!\[.*?\]\(.*?\)/g, '')
    // Remove links but keep text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove headers markup but keep text
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    // Remove strikethrough
    .replace(/~~([^~]+)~~/g, '$1')
    // Remove blockquotes
    .replace(/^>\s+/gm, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}$/gm, '')
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Remove admonition syntax (MkDocs style)
    .replace(/^!!!\s+\w+.*$/gm, '')
    // Normalize whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractSections(content: string): { heading: string; content: string; id: string }[] {
  const sections: { heading: string; content: string; id: string }[] = [];
  const lines = content.split('\n');

  let currentHeading = '';
  let currentId = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,3})\s+(.+)$/);

    if (headingMatch) {
      // Save previous section if exists
      if (currentHeading && currentContent.length > 0) {
        sections.push({
          heading: currentHeading,
          id: currentId,
          content: stripMarkdown(currentContent.join('\n')),
        });
      }

      // Start new section
      currentHeading = headingMatch[2];
      currentId = currentHeading
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-');
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentHeading && currentContent.length > 0) {
    sections.push({
      heading: currentHeading,
      id: currentId,
      content: stripMarkdown(currentContent.join('\n')),
    });
  }

  return sections;
}

function extractTitleFromContent(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function processGuidesDirectory(): SearchDocument[] {
  const documents: SearchDocument[] = [];
  const directory = path.join(CONTENT_DIR, 'guides');

  if (!fs.existsSync(directory)) {
    console.warn(`Directory not found: ${directory}`);
    return documents;
  }

  const files = fs.readdirSync(directory).filter(f => f.endsWith('.mdx'));

  for (const file of files) {
    const slug = file.replace(/\.mdx$/, '');
    const fullPath = path.join(directory, file);
    const fileContents = fs.readFileSync(fullPath, 'utf8');
    const { data, content } = matter(fileContents);

    const title = (data.title && data.title.trim()) || extractTitleFromContent(content) || slug;
    const strippedContent = stripMarkdown(content);

    // Add main page document
    documents.push({
      id: `guides:${slug}`,
      slug,
      title,
      description: data.description,
      content: strippedContent,
      type: 'guide',
    });

    // Add section documents for better granular search
    const sections = extractSections(content);
    for (const section of sections) {
      if (section.content.length > 50) { // Only index substantial sections
        documents.push({
          id: `guides:${slug}#${section.id}`,
          slug: `${slug}#${section.id}`,
          title: section.heading,
          content: section.content,
          section: section.heading,
          type: 'guide',
        });
      }
    }
  }

  return documents;
}

function generateSearchIndex() {
  console.log('Generating search index...');

  const guides = processGuidesDirectory();

  // Ensure public directory exists
  const publicDir = path.join(process.cwd(), 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(guides, null, 2));

  console.log(`Search index generated with ${guides.length} documents`);
  console.log(`Output: ${OUTPUT_PATH}`);
}

generateSearchIndex();
