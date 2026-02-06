# Redaction Plotter

A generative art tool for creating plotter-ready asemic writing and abstract text compositions. Built with p5.js and claude code, optimized for pen plotter output.

<img width="2680" height="3954" alt="Redaction_plotter-26" src="https://github.com/user-attachments/assets/99763e40-7f47-4142-81d2-f9c8eb57468d" />

![Redaction Example](preview.png)
<img width="2680" height="3432" alt="Redaction_plotter-27" src="https://github.com/user-attachments/assets/4198f4af-21f4-4811-8b00-a7c29f956f61" />



## Features

### Composition Modes
- **7 Original Versions** — Different shape sizes, densities, and layouts
- **Text-like Layout** — Baseline-aligned word groupings with ascenders/descenders
- **Fibonacci Modes** — Fibonacci-based spacing and word groupings for organic rhythm
- **Fibonacci Spiral** — Golden angle spiral composition (137.5°) inspired by phyllotaxis patterns

### Plotter-Optimized Fill Styles
- **Hatching** — Parallel lines at configurable angles
- **Cross-hatch** — Perpendicular line pairs
- **Stippling** — Dot-based fills using point-in-polygon distribution
- **Contour** — Concentric lines following shape edges
- **Scribble** — Gestural random-walk marks
- **Outline Only** — Borders without fill

### Export Options
- **SVG Export** — Grouped by pen color for multi-pen plotting
- **PNG Export** — High-quality raster output
- **Preset System** — Save/load complete settings including seeds for reproducibility
- **Import/Export Presets** — Share configurations as JSON files

### Display Controls
- Multiple color palettes (Black, Greyscale, Colorz, Colors, Colorsz, Multi-color, White)
- Adjustable stroke weight
- Background color options
- Hide outline option for fill-only rendering
- Auto-fit canvas height

## Usage

1. Open `index.html` in a web browser
2. Adjust composition settings (version, layout mode, spacing)
3. Adjust display settings (fill style, density, colors)
4. Click "Regenerate" or click on the canvas to create new compositions
5. Export as SVG for plotting or PNG for preview

## Controls

### Composition (regenerates artwork)
- **Version (1-7)** — Shape style and size variations
- **Text-like Layout** — Enable baseline-aligned text simulation
- **Text Mode** — Regular, Fibonacci Spacing, Fibonacci Words, or Both
- **Fibonacci Spiral** — Arrange shapes along golden angle spiral
- **Auto-fit Height** — Expand canvas to fit composition
- **Line Height** — Row spacing / spiral density
- **Word Spacing** — Horizontal spacing / spiral expansion
- **Baseline Jitter** — Vertical randomness per row

### Display (preserves shapes)
- **Fill Style** — Hatching, Cross-hatch, Stippling, Contour, Scribble, Outline
- **Fill Density** — Line/dot spacing within shapes
- **Hatch Angle** — Random, Uniform, Horizontal, or Vertical
- **Hide Outline** — Remove shape borders
- **Stroke Weight** — Line thickness
- **Stroke Color** — Color palette selection
- **Background** — Canvas background color

## Presets

Save your favorite settings including the random seed for exact reproducibility:
1. Click "Save Settings" and enter a name
2. Load saved presets from the dropdown
3. Export all presets as JSON for backup or sharing
4. Import presets from JSON files

## Technical Details

- Canvas: 1340 × 1680 pixels (portrait, suitable for A3/11×17)
- Built with p5.js 1.9.0
- Self-contained single HTML file
- SVG output with color grouping for efficient multi-pen workflows
- Seeded randomness for reproducible compositions

## License

MIT License — See [LICENSE](LICENSE) for details.

## Credits

Created with p5.js. Inspired by asemic writing, redacted documents, and generative typography.
