# VN Club

A free, open resource site for learning Japanese through visual novels. Browse the VNDB catalog, get personalized recommendations, follow setup guides, and check your reading stats, all in one place.

## Website

Visit: [vnclub.org](https://vnclub.org/)

## Features

- 15+ setup guides for essential tools (Textractor, Yomitan, Anki, and more)
- Browse and search the full VNDB catalog with filtering and detail pages
- Personalized VN recommendations based on your VNDB list
- VNDB user stats lookup
- Aggregated VN news feed
- Kana quiz for beginners
- Full-text search across all content
- Dark mode support

## Contributing

Contributions are always welcome. Whether it's fixing a typo, improving a guide, or adding new content, feel free to open a PR or issue.

Guide content lives in `content/guides/` as MDX files. The site is built with Next.js and Tailwind CSS, with a FastAPI + PostgreSQL backend for VNDB data.

```bash
# Frontend development
npm install
npm run dev

# Backend (Docker)
npm run api:dev
```

## Community

Join us on [Discord](https://discord.gg/Ze7dYKVTHf) to connect with fellow learners, get help with setup, and share recommendations.
