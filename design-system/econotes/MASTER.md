# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/econotes/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** EcoNotes
**Generated:** 2026-10-21 18:50:09
**Category:** Analytics Dashboard
**Design Dials:** Variance 3/10 (Centered / Minimal) | Motion 2/10 (Subtle) | Density 7/10 (Standard)

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#1E40AF` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#3B82F6` | `--color-secondary` |
| On Secondary | `#000000` | `--color-on-secondary` |
| Accent / event | `#B45309` | `--color-accent` |
| On Accent / event | `#FFFFFF` | `--color-on-accent` |
| Background | `#F4F7FB` | `--color-background` |
| Foreground | `#172B4D` | `--color-foreground` |
| Card | `#FFFFFF` | `--color-card` |
| Card Foreground | `#172B4D` | `--color-card-foreground` |
| Muted | `#F1F5F9` | `--color-muted` |
| Muted Foreground | `#52657A` | `--color-muted-foreground` |
| Border | `#D8E1EC` | `--color-border` |
| Destructive | `#B42318` | `--color-destructive` |
| On Destructive | `#FFFFFF` | `--color-on-destructive` |
| Ring | `#1E40AF` | `--color-ring` |

**Color Notes:** Blue data + amber highlights [Accent adjusted from #F59E0B]

### Typography

- **Primary font:** Vazirmatn, already self-hosted in the project for Persian content.
- **Numerals:** tabular numerals for aligned financial values; keep source symbols and ISO dates legible in chart tooltips.
- **Mood:** analytical, restrained, precise, Persian-first.

### Spacing Variables

*Density: 7/10 — Standard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #1E40AF;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  background: #1D4ED8;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #1E40AF;
  border: 2px solid #1E40AF;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #FFFFFF;
  border: 1px solid #D8E1EC;
  border-radius: 10px;
  padding: 24px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.035);
  transition: border-color 160ms ease, box-shadow 160ms ease;
  cursor: pointer;
}

.card:hover {
  border-color: #93B4EA;
  box-shadow: 0 6px 18px rgba(30, 64, 175, 0.08);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #CBD5E1;
  border-radius: 8px;
  font-size: 16px;
  color: #172B4D;
  background: #FFFFFF;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #1E40AF;
  outline: none;
  box-shadow: 0 0 0 3px #1E40AF20;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Minimalism & Swiss Style

**Keywords:** Clean, simple, spacious, functional, white space, high contrast, geometric, sans-serif, grid-based, essential

**Best For:** Enterprise apps, dashboards, documentation sites, SaaS platforms, professional tools

**Key Effects:** Subtle hover (200-250ms), smooth transitions, sharp shadows if any, clear type hierarchy, fast loading

### Page Pattern

**Pattern Name:** Macro Research Workspace

- **Information order:** source-aware headline and macro indicators, market risk measures, historical sensitivity and relationships, then the data catalog and methodology.
- **Primary action:** open macro analysis; keep secondary navigation for the catalog and historical scenario tools.
- **Trust signals:** show source, frequency, observation date, sample size and calculation caveats in context. Never label descriptive estimates as validated forecasts.
- **Navigation:** compact persistent sidebar with named analytical areas and a short list of quick-access series.

---

## Motion and feedback

- Keep feedback immediate and limited to color, border and small position changes on direct interaction.
- Do not add scroll-reveal animation or a motion library to analytical views without a specific product need.
- Preserve the final readable state when `prefers-reduced-motion: reduce` is enabled.
- Make translucent navigation opaque when `prefers-reduced-transparency: reduce` is enabled.

---

## Anti-Patterns (Do NOT Use)

- ❌ Ornate design
- ❌ No filtering

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
