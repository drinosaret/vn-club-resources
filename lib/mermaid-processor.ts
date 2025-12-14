import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Pre-renders mermaid diagrams in markdown content at build time using mermaid-cli.
 * This eliminates layout shift by embedding SVG directly in the content.
 */
export async function processMermaidDiagrams(content: string): Promise<string> {
  // Find mermaid code blocks
  const mermaidRegex = /```mermaid\r?\n([\s\S]*?)```/g;
  const matches = [...content.matchAll(mermaidRegex)];

  if (matches.length === 0) {
    return content;
  }

  let processedContent = content;

  // Create a temp directory for mermaid files
  const tempDir = join(tmpdir(), 'mermaid-render');
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const fullMatch = match[0];
    const mermaidCode = match[1].trim();

    const inputFile = join(tempDir, `diagram-${i}.mmd`);
    const outputFile = join(tempDir, `diagram-${i}.svg`);

    try {
      // Write mermaid code to temp file
      writeFileSync(inputFile, mermaidCode, 'utf8');

      // Run mermaid CLI to generate SVG
      const mmdc = join(process.cwd(), 'node_modules', '.bin', 'mmdc');
      execSync(`"${mmdc}" -i "${inputFile}" -o "${outputFile}" -t neutral -b transparent`, {
        stdio: 'pipe',
        timeout: 30000,
      });

      // Read the generated SVG
      const svg = readFileSync(outputFile, 'utf8');

      // Wrap SVG in a container div for styling
      const wrappedSvg = `<div class="mermaid-container my-6 flex justify-center">${svg}</div>`;

      processedContent = processedContent.replace(fullMatch, wrappedSvg);

      // Clean up temp files
      unlinkSync(inputFile);
      unlinkSync(outputFile);
    } catch (error) {
      console.error('Failed to render mermaid diagram:', error);
      // Clean up on error
      try {
        if (existsSync(inputFile)) unlinkSync(inputFile);
        if (existsSync(outputFile)) unlinkSync(outputFile);
      } catch {
        // Ignore cleanup errors
      }
      // Keep original on error - will fall back to client-side rendering
    }
  }

  return processedContent;
}
