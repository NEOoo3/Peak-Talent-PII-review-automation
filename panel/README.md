# panel/

The review panel and its logic. The panel is rendered into a closed Shadow DOM, so the site's styles can't reach it and its styles can't leak into the site.

| File | Purpose |
|---|---|
| `brand.js` | The wordmark shown in the panel header (falls back to text) |
| `panel-styles.js` | Panel CSS as a string: frosted-glass theme, light and dark, launcher, cards, sheets |
| `decisions.js` | Pure review logic: sections, questions per finding, what each answer means, merging both checks into one list |
| `panel.js` | Panel UI: launcher, grouped review list, navigation, filters, Add and teach sheets, per-group Fill, settings, footer |
| `picker.js` | **Set up manually**: point at the left document, the right document and one label; clicks never reach the site |
