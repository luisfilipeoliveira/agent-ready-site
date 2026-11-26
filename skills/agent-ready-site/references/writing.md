# Writing the Markdown copies

## Shape
- Keep the page's own headings as `##` / `###` (the generator writes the `# Title`). Keep the page's order.
- Use plain Markdown only: headings, paragraphs, `-` lists, `>` quotes, `**bold**` where the page emphasises, and `[text](absolute URL)` links.
- Write every link as an absolute URL on the production domain (`https://example.com/work/case`). Agents read these files out of context.
- Use one blank line between blocks, with no HTML, no images and no tables unless the page itself is a table.
- Testimonials: `> quote` then `>` then `> Name, Role`.
- Lists of items such as experience, projects or services: one `###` per item, then its lines in the page's order.

## Words
- Use the site's words. Light edits are allowed only to make text read as prose outside the layout: for example, joining a card's label and value into one sentence, or turning "→" into "to".
- No marketing additions, adjectives the site doesn't use, or summaries the site doesn't give.
- The `summary` in the frontmatter is the page's own lead line, or its meta description when it has no lead. The generator prints it as `> summary` under the title, so don't repeat it in the body: start the body with what comes after the lead.
- Leave out anything the page doesn't show to an anonymous visitor.

## Privacy
- Contact details go only in `site.json` → `contact`, and only those the site already shows publicly (for example a `mailto:` link in the footer, or a social profile link).
- Never copy content from behind a login or password, from unpublished drafts, from environment variables, or from private docs in the repo (such as `docs/` notes and briefs) unless that text is on a public page.
- No analytics IDs, tokens or internal URLs.
