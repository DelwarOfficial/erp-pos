# Skills Index

Catalog of the 65 skills bundled in `skills/`. Each entry lists the directory, the
`name:` declared in its `SKILL.md`, and a short summary of what it does. Bundled
assets beyond `SKILL.md` are noted where they matter (scripts, templates, references).

These are general-purpose agent skills vendored into the repository. They are not part
of the ERP/POS application code under `src/`.

## Z.AI SDK wrappers (`z-ai-web-dev-sdk`)

| Directory | Name | Summary |
|---|---|---|
| `LLM` | LLM | Chat completions — multi-turn conversations, system prompts, context management. Has `scripts/`. |
| `VLM` | VLM | Vision chat — analyze images from URL or base64, multimodal conversation. Has `scripts/`. |
| `ASR` | ASR | Speech-to-text transcription from base64 audio. Has `scripts/`. |
| `TTS` | TTS | Text-to-speech with multiple voices, adjustable speed and formats. Ships `tts.ts`. |
| `image-generation` | image-generation | Text-to-image generation plus a CLI tool. Has `scripts/`. |
| `image-edit` | image-edit | Edit and transform existing images from text descriptions, plus CLI. Has `scripts/`. |
| `image-understand` | image-understand | Image analysis, OCR, object detection, classification. Has `scripts/`. |
| `image-search` | image-search | In-house image search returning reachable OSS-hosted URLs. |
| `video-generation` | Video Generation | Text/image-to-video with async task polling. Has `scripts/`. |
| `video-understand` | video-understand | Video analysis — motion, temporal sequences, scene description. Has `scripts/`. |
| `web-search` | web-search | Real-time web search returning structured results. Has `scripts/`. |
| `web-reader` | web-reader | Web page content extraction — title, HTML, publication time. Has `scripts/`. |

## Research and search

| Directory | Name | Summary |
|---|---|---|
| `aminer-academic-search` | aminer-academic-search | Full AMiner Open Platform access — 27 APIs, 5 workflows, via the z-ai gateway. Takes precedence over general web search for academic queries. Has `scripts/`. |
| `aminer-free-academic` | aminer-free-academic | Free-tier AMiner entry point (7 APIs, zero cost) for single-step academic lookups; routes to `aminer-academic-search` for anything paid. Has `evals/`, `references/`. |
| `aminer-daily-paper` | aminer-daily-paper | Personalized paper recommendations by topic or author (`/aminer-dp`). Has `scripts/`, `README.md`. |
| `multi-search-engine` | multi-search-engine | Eight Chinese search engines with operators, time filters, site search, WeChat article search. No API keys. Has `config.json`, `references/`. |
| `qingyan-research` | qingyan_research_report | Multi-step deep web research producing publication-quality HTML reports with Chart.js visualizations. Ships `generate_html.py`. |
| `market-research-reports` | market-research-reports | 50+ page consulting-style market research reports in LaTeX, with Porter's Five Forces, PESTLE, SWOT, TAM/SAM/SOM, BCG Matrix. Has `scripts/`, `assets/`, `references/`. |
| `ai-news-collectors` | ai-news-collector | Chinese-language AI news aggregation ranked by heat, with source links. Has `references/`. |
| `contentanalysis` | ContentAnalysis | Wisdom and insight extraction from videos, podcasts, articles, YouTube. Has `ExtractWisdom/`. |

## Document and file production

| Directory | Name | Summary |
|---|---|---|
| `docx` | docx | Word documents — create, edit, tracked changes, comments, text extraction. Has `scripts/`, `references/`, `routes/`, `scenes/`. |
| `xlsx` | xlsx | Spreadsheets — read, edit, create, charts, pivots, format conversion. Ships `xlsx.py`, `engines/`, `templates/`, `quality/`. |
| `pptx` | ppt | Presentations — create, edit, layouts, speaker notes, plus an embedded Beamer module for academic decks. Has `scripts/`, `ooxml/`. |
| `pdf` | pdf | Four PDF production lines: ReportLab reports, JSON-blueprint creative design, LaTeX/Tectonic academic, and manipulation of existing PDFs. Has `scripts/`, `typesetting/`, `configs/`. |
| `charts` | charts | Data charts and structural diagrams — bar, line, pie, heatmap, candlestick, flowchart, mind map, ER, Gantt, sequence. Has `setup.sh`, `references/`. |
| `cheat-sheet` | cheat-sheet | Condenses PDF/Word/Markdown study material into two-column small-print PDF cheat sheets in three styles. |

## Design and frontend

| Directory | Name | Summary |
|---|---|---|
| `design` | Design Skill | Router for HTML artifact design tasks — landing pages, portfolios, prototypes, decks, content pages, web tools, social cards. Largest skill here: design systems, templates, quality gate. |
| `ui-ux-pro-max` | ui-ux-pro-max | UI/UX design intelligence — layouts, IA, design tokens, component specs, microcopy, accessibility, across React/Next/Vue/Svelte/Tailwind. Has `scripts/`, `data/`, `references/`. |
| `visual-design-foundations` | visual-design-foundations | Typography, color theory, spacing systems, iconography for design tokens and style guides. Has `references/`. |
| `web-shader-extractor` | web-shader-extractor | Extracts WebGL/Canvas/shader effects from web pages, deobfuscates, ports to standalone JS. Has `scripts/`, `references/`. |
| `quiz-html` | quiz-html | Renders a question array into a standalone HTML practice page. Has `templates/`, `scripts/`, `examples/`. |

## Software development

| Directory | Name | Summary |
|---|---|---|
| `fullstack-dev` | fullstack-dev | Next.js 16 + TypeScript + Tailwind 4 + shadcn/ui + Prisma scaffolding and development. Closest to this repository's own stack. |
| `coding-agent` | coding-agent | Coding workflow — planning, execution, verification, testing. Ships `planning.md`, `execution.md`, `verification.md`, `criteria.md`, `memory-template.md`, `state.md`. |
| `writing-plans` | writing-plans | Turns a spec or requirements into a multi-step plan before any code is written. |
| `version-management` | Version Management Skill | Governs where frontend project files land on disk and manages project version history. Meant to be read before writing any `.html`/`.jsx`/`.tsx`/`.vue` entry file. |
| `agent-browser` | Agent Browser | Rust headless browser automation CLI with Node fallback — navigate, click, type, snapshot. |
| `skill-creator` | skill-creator | Create, edit, and optimize skills; run evals and benchmark triggering accuracy. Has `agents/`, `eval-viewer/`, `scripts/`, `references/`. |
| `skill-finder-cn` | skill-finder-cn | Discovers and installs ClawHub skills. Answers "what skill can do X". Has `scripts/`. |
| `task-review` | task-review | After a high-complexity task, saves the path taken as a reusable skill with a generated `SKILL.md`. |

## Career and hiring

| Directory | Name | Summary |
|---|---|---|
| `resume-builder` | resume-builder | Writes or overhauls a Chinese resume from scratch; STAR rewriting, ATS keyword coverage, docx/pdf/markdown export. Has `scripts/`, `references/`. |
| `jd-resume-tailor` | jd-resume-tailor | Decomposes a job description and rewrites an existing resume against it with gap analysis. Not for from-scratch resumes. Has `scripts/`, `references/`. |
| `job-intent-tracker` | job-intent-tracker | Clarifies job-search direction, builds a target-role profile, maintains an application tracking table. Has `scripts/`, `references/`. |
| `interview-prep` | interview-prep | Builds a printable interview prep handbook — question bank, model answers, behavioral/technical/case categories. Has `scripts/`, `references/`. |
| `interview-designer` | interview-designer | Designs interview strategy from a resume using Topgrading, performance-based hiring, and bias control. Has `templates/`, `references/`, `README.md`. |

## Learning

| Directory | Name | Summary |
|---|---|---|
| `study-buddy` | study-buddy | Manages long-term study projects — plans, progress reports, daily/weekly/monthly reviews, dynamic replanning. |
| `quiz-mastery` | quiz-mastery | Question generation, quizzing, spaced-repetition review, mastery scoring. Has `scripts/`, `src/`. |
| `gaokao-collect-student-info` | gaokao-collect-student-info | Step 1 of the gaokao pipeline — collects province, score, subject choices and interests into `student.json`. Has `examples/`. |
| `gaokao-fetch-volunteers` | gaokao-fetch-volunteers | Step 2 — calls the recommendation API, outputs `parsed.json`. Has `scripts/`, `preference_mapping.md`. |
| `gaokao-recommend-majors` | gaokao-recommend-majors | Step 3 — agent analysis producing `major_recommendation.json`. |
| `gaokao-recommend-schools` | gaokao-recommend-schools | Step 4 — school recommendations with rationale, `school_recommendation.json`. |
| `gaokao-generate-report` | gaokao-generate-report | Step 5 — merges the prior JSON files into an HTML application report. Has `scripts/`, `templates/`. |

## Marketing and writing

| Directory | Name | Summary |
|---|---|---|
| `marketing-mode` | marketing-mode | Bundle of 23 marketing skills — strategy, psychology, content, SEO, conversion, paid growth. |
| `content-strategy` | content-strategy | Content marketing strategy for solopreneurs — pillars, calendar, distribution, repurposing, metrics. |
| `seo-content-writer` | seo-content-writer | SEO-optimized articles and blog posts with on-page best practices. Has `references/`. |
| `blog-writer` | blog-writer | Long-form posts in a specific author's voice, from research through Notion publication. Ships a style guide and seven example posts. |
| `storyboard-manager` | storyboard-manager | Fiction writing support — character development, plot structure, chapter drafting, timeline and consistency checking. Has `scripts/`, `references/`. |
| `podcast-generate` | Podcast Generate | Generates dual- or single-host podcast episodes (script plus WAV) from supplied content or a web-searched topic, 3–20 minutes. |

## Finance

| Directory | Name | Summary |
|---|---|---|
| `finance` | finance | Finance API integration — quotes, historical data, company financials, screening, market news. Ships `Finance_API_Doc.md`. |
| `stock-analysis-skill` | stock_analysis | A-share, Hong Kong and US equity analysis — decision dashboards, position-aware strategy, dividend scoring, rumor scanning, watchlists, K-line image reading. Has `src/`. |

## Personal and lifestyle

| Directory | Name | Summary |
|---|---|---|
| `anti-pua` | anti-pua | Analyzes manipulation and PUA patterns — gaslighting, dark triad traits, NPD indicators — and advises on handling the relationship. |
| `mindfulness-meditation` | mindfulness-meditation | Guided meditation sessions, streaks, mindfulness reminders. |
| `auto-target-tracker` | auto-target-tracker | Detects goal-related images in conversation, runs VLM recognition, logs progress to a goal journal. |
| `dream-interpreter` | dream-interpreter | Dream interpretation from three angles, emitting structured JSON for a front-end card. Has `scripts/`, `assets/`, `references/`. |
| `get-fortune-analysis` | get-fortune-analysis | Generates an ornate annual fortune report. Ships `lunar_python.py`. |
| `gift-evaluator` | gift-evaluator | Values and authenticates Spring Festival gifts from photos and drafts the social reply. Ships `html_tools.py`. |

## Notes

- Several skills form explicit pipelines. The five `gaokao-*` skills run in order;
  `quiz-mastery` hands off to `quiz-html` for practice pages and defers long-term
  planning to `study-buddy`.
- The AMiner skills route between themselves: `aminer-free-academic` handles free-tier
  lookups and escalates to `aminer-academic-search` for anything requiring paid APIs.
- Many skills are written primarily in Chinese; the summaries above are in English.
- There is no `skills/README.md`; this file is the entry point.
