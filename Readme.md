# VN Club

A free, open resource site for learning Japanese through visual novels. Browse the VNDB catalog, get personalized recommendations, follow setup guides, and check your reading stats, all in one place.

## Website

Visit: [vnclub.org](https://vnclub.org/)

## Features

- **Guides** - 15+ setup guides for essential tools (Textractor, Yomitan, Anki, and more)
- **Browse** - Search and filter the full VNDB catalog with detail pages for VNs, characters, staff, and producers
- **Recommendations** - Personalized VN recommendations based on your VNDB list
- **Stats** - VNDB user stats lookup with reading history and analytics
- **Word of the Day** - Daily Japanese vocabulary with definitions, pitch accent, conjugations, example sentences from VNs, kanji breakdown with readings and compounds, related VNDB tags, and bilingual example sentences
- **News** - Aggregated VN news feed
- **Quiz** - Kana quiz for beginners
- **Discord bot** - Daily Word of the Day and VN of the Day posts
- **Just for Fun** - Tier list maker, 3x3 collage creator, and VN roulette
- **Full-text search** across all content
- **Dark mode** support
- **Multilingual** - English and Japanese UI

## Contributing

Contributions are always welcome. Whether it's fixing a typo, improving a guide, or adding new content, feel free to open a PR or issue.

Guide content lives in `content/guides/` as MDX files. The site is built with Next.js and Tailwind CSS, with a FastAPI + PostgreSQL backend for VNDB data.

```bash
# Frontend development
npm install
npm run dev

# Backend (Docker)
npm run api:dev

# Both together
npm run dev:all
```

## Community

Join us on [Discord](https://discord.gg/Ze7dYKVTHf) to connect with fellow learners, get help with setup, and share recommendations.

## Data Sources

- [VNDB](https://vndb.org/) - Visual novel data, tags, characters, and cover images
- [Jiten.moe](https://jiten.moe/) - Word frequency data, reading statistics, and example sentences
- [KanjiAPI](https://kanjiapi.dev/) - Kanji details, readings, and compound words
- [Jisho.org](https://jisho.org/) - JLPT levels and dictionary data
- [Tatoeba](https://tatoeba.org/) - Bilingual example sentences
- [JMdict/KANJIDIC](https://www.edrdg.org/) - Dictionary data from the Electronic Dictionary Research and Development Group

## License

[GNU Affero General Public License (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.en.html)
