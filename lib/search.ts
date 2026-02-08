export interface SearchDocument {
  id: string;
  slug: string;
  title: string;
  content: string;
  description?: string;
  section?: string;
  type: 'guide';
}

export interface SearchResult {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  section?: string;
  type: 'guide';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let searchIndex: any = null;
let documents: SearchDocument[] = [];
let documentMap: Map<string, SearchDocument> = new Map();
let indexLoaded = false;

export async function loadSearchIndex(): Promise<void> {
  if (indexLoaded) return;

  const response = await fetch('/search-index.json', {
    signal: AbortSignal.timeout(10000), // 10s timeout
  });
  if (!response.ok) {
    throw new Error(`Failed to load search index: ${response.status}`);
  }
  documents = await response.json();

  // Build a map for quick lookups
  documentMap = new Map(documents.map(doc => [doc.id, doc]));

  // Dynamically import FlexSearch so it's not bundled with every page
  const FlexSearch = (await import('flexsearch')).default;

  // Create a simple index for searching
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  searchIndex = new (FlexSearch as any).Index({
    tokenize: 'forward',
    encode: (str: string) => {
      // Custom encoder that works with both English and Japanese
      const tokens: string[] = [];
      const words = str.toLowerCase().split(/\s+/);

      for (const word of words) {
        tokens.push(word);
        // For CJK characters, also add individual characters and n-grams
        const cjkChars = word.match(/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/g);
        if (cjkChars) {
          tokens.push(...cjkChars);
          // Add bigrams for better CJK matching
          for (let i = 0; i < word.length - 1; i++) {
            if (/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(word[i])) {
              tokens.push(word.substring(i, i + 2));
            }
          }
        }
      }

      return tokens;
    },
  });

  // Add all documents to the index
  // Combine title, description, and content for searching
  for (const doc of documents) {
    const searchableText = [doc.title, doc.description || '', doc.content].join(' ');
    searchIndex.add(doc.id, searchableText);
  }

  indexLoaded = true;
}

function getExcerpt(content: string, query: string, maxLength: number = 150): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Find the position of the query in the content
  const position = lowerContent.indexOf(lowerQuery);

  if (position === -1) {
    // If exact match not found, return the beginning
    return content.slice(0, maxLength) + (content.length > maxLength ? '...' : '');
  }

  // Calculate start and end positions for the excerpt
  const start = Math.max(0, position - 50);
  const end = Math.min(content.length, position + query.length + 100);

  let excerpt = content.slice(start, end);

  // Add ellipsis if needed
  if (start > 0) excerpt = '...' + excerpt;
  if (end < content.length) excerpt = excerpt + '...';

  return excerpt;
}

const MAX_QUERY_LENGTH = 500;

export async function searchContent(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > MAX_QUERY_LENGTH) return [];

  await loadSearchIndex();

  if (!searchIndex) return [];

  // Search the index
  const resultIds: string[] = searchIndex.search(query, { limit: 20 });

  // Map IDs back to documents
  const searchResults: SearchResult[] = [];

  for (const id of resultIds) {
    const doc = documentMap.get(id);
    if (doc) {
      searchResults.push({
        id: doc.id,
        slug: doc.slug,
        title: doc.title,
        excerpt: getExcerpt(doc.content, query),
        section: doc.section,
        type: doc.type,
      });
    }
  }

  return searchResults;
}
