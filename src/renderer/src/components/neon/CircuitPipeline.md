# CircuitPipeline Component

A reusable neon-styled component that visualizes pipeline stages with a circuit board aesthetic. Features animated "current flow" effects and glowing neon nodes.

## Features

- ⚡ **Circuit board aesthetic** — Nodes connected by circuit traces with flowing current animation
- 🎨 **Neon design system** — Uses accent colors (cyan, pink, blue, purple, orange, red)
- 📊 **Stage visualization** — Display counts and labels for each pipeline stage
- 🔄 **Animated flows** — Optional animated "current pulse" effect along circuit traces
- 📱 **Responsive** — Supports both horizontal and vertical orientations
- ♿ **Accessible** — Respects reduced motion preferences
- 🎯 **Compact mode** — Smaller size for tight spaces

## Usage

### Basic Example

```tsx
import { CircuitPipeline, type CircuitNode } from '@/components/neon/CircuitPipeline'

const nodes: CircuitNode[] = [
  { id: 'queued', label: 'Queued', count: 5, accent: 'orange' },
  { id: 'active', label: 'Active', count: 3, accent: 'cyan', active: true },
  { id: 'review', label: 'Review', count: 2, accent: 'blue' },
  { id: 'done', label: 'Done', count: 12, accent: 'purple' }
]

;<CircuitPipeline nodes={nodes} />
```

### With Icons

```tsx
const nodes: CircuitNode[] = [
  { id: 'queued', label: 'Queued', count: 5, accent: 'orange', icon: '⏳' },
  { id: 'active', label: 'Active', count: 3, accent: 'cyan', icon: '⚡', active: true },
  { id: 'review', label: 'Review', count: 2, accent: 'blue', icon: '👁️' },
  { id: 'done', label: 'Done', count: 12, accent: 'purple', icon: '✓' }
]

;<CircuitPipeline nodes={nodes} animated={true} />
```

### Vertical Layout

```tsx
<CircuitPipeline nodes={nodes} orientation="vertical" animated={true} />
```

### Compact Mode

```tsx
<CircuitPipeline nodes={nodes} compact={true} className="my-custom-class" />
```

## Props

### `CircuitPipeline`

| Prop          | Type                         | Default        | Description                          |
| ------------- | ---------------------------- | -------------- | ------------------------------------ |
| `nodes`       | `CircuitNode[]`              | required       | Array of pipeline stage nodes        |
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Layout direction                     |
| `animated`    | `boolean`                    | `true`         | Enable animated current flow effects |
| `compact`     | `boolean`                    | `false`        | Use smaller node size (64px vs 80px) |
| `className`   | `string`                     | `''`           | Additional CSS classes               |

### `CircuitNode`

| Property | Type         | Required | Description                                                                  |
| -------- | ------------ | -------- | ---------------------------------------------------------------------------- |
| `id`     | `string`     | ✓        | Unique identifier for the node                                               |
| `label`  | `string`     | ✓        | Display label (e.g., "Queued")                                               |
| `count`  | `number`     | ✓        | Number to display in the node                                                |
| `accent` | `NeonAccent` | ✓        | Color accent (`'cyan' \| 'pink' \| 'blue' \| 'purple' \| 'orange' \| 'red'`) |
| `icon`   | `ReactNode`  |          | Optional icon to display above the count                                     |
| `active` | `boolean`    |          | If true, node will pulse with neon glow                                      |

## Integration Example: Sprint Center

See `CircuitPipelineExample.tsx` for a complete Sprint Center integration example:

```tsx
import { CircuitPipelineExample } from './CircuitPipelineExample'

// In SprintCenter header:
;<div className="sprint-center__title-row">
  <span className="sprint-center__title text-gradient-aurora">SPRINT CENTER</span>
  <CircuitPipelineExample tasks={filteredTasks} compact={true} />
</div>
```

## Styling

The component uses CSS custom properties from the neon design system:

- `--neon-{accent}` — Primary accent color
- `--neon-{accent}-glow` — Glow shadow effect
- `--neon-{accent}-surface` — Semi-transparent surface color
- `--neon-{accent}-border` — Border color

### Animations

Three keyframe animations are used:

1. **`circuit-pulse`** — Pulsing glow effect for active nodes
2. **`circuit-flow-horizontal`** — Current flowing left to right
3. **`circuit-flow-vertical`** — Current flowing top to bottom

All animations respect `prefers-reduced-motion` settings.

## Accessibility

- Uses semantic HTML with ARIA attributes
- Decorative elements marked with `aria-hidden="true"`
- Animations disabled for users with `prefers-reduced-motion: reduce`
- Proper color contrast ratios maintained

## Performance

- Nodes and connectors are pure CSS (no canvas/SVG overhead)
- Animations use `transform` and `opacity` for GPU acceleration
- `useMemo` recommended when computing node data from large datasets

## Browser Support

Works in all modern browsers that support:

- CSS custom properties
- CSS animations
- Flexbox
- CSS gradients with multiple color stops
