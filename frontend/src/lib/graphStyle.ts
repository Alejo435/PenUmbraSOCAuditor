import type { NodeSingular, StylesheetJson } from 'cytoscape'

// reads a design token from the root element, since cytoscape draws on canvas and cannot use css variables
function token(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// risk as a fraction from 0 to 1, so sizes and glow can scale with how dangerous a node is
function riskOf(node: NodeSingular) {
  return Math.min(100, Math.max(0, Number(node.data('risk')) || 0)) / 100
}

// entity types are told apart mainly by shape, so color is never the only cue
const SHAPES = {
  user: 'ellipse',
  host: 'round-rectangle',
  ip: 'diamond',
  process: 'hexagon',
  file: 'round-tag',
} as const

// builds the graph stylesheet from the current tokens: nodes are dark silhouettes rim-lit
// by their entity tint, and anything a detection touched is lit in corona
export function buildGraphStyle(): StylesheetJson {
  const entityStyles: StylesheetJson = Object.entries(SHAPES).map(([type, shape]) => ({
    selector: `node[type = "${type}"]`,
    style: { shape, 'border-color': token(`--entity-${type}`) },
  }))

  return [
    {
      selector: 'node',
      style: {
        // riskier nodes grow slightly, so danger reads even before the glow is noticed
        width: (node: NodeSingular) => 26 + riskOf(node) * 14,
        height: (node: NodeSingular) => 26 + riskOf(node) * 14,
        'background-color': token('--umbra-700'),
        'border-width': 1.5,
        label: 'data(label)',
        color: token('--penumbra-200'),
        'font-family': 'IBM Plex Sans, system-ui, sans-serif',
        'font-size': 10,
        'text-valign': 'bottom',
        'text-margin-y': 6,
        'text-max-width': '120px',
        'text-wrap': 'ellipsis',
        'text-outline-color': token('--umbra-900'),
        'text-outline-width': 2,
      },
    },
    ...entityStyles,
    {
      selector: 'node.flagged',
      style: {
        'border-color': token('--corona-500'),
        'border-width': 2.5,
        color: token('--light-100'),
        'underlay-color': token('--corona-500'),
        'underlay-opacity': (node: NodeSingular) => 0.12 + riskOf(node) * 0.3,
        'underlay-padding': (node: NodeSingular) => 6 + riskOf(node) * 12,
        'underlay-shape': 'ellipse',
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1,
        'line-color': token('--umbra-500'),
        'target-arrow-shape': 'triangle',
        'target-arrow-color': token('--umbra-500'),
        'arrow-scale': 0.7,
        'curve-style': 'bezier',
      },
    },
    {
      selector: 'edge.suspicious',
      style: {
        width: 2,
        'line-color': token('--corona-500'),
        'target-arrow-color': token('--corona-500'),
        label: 'data(label)',
        color: token('--corona-400'),
        'font-family': 'IBM Plex Sans, system-ui, sans-serif',
        'font-size': 9,
        'text-rotation': 'autorotate',
        'text-outline-color': token('--umbra-900'),
        'text-outline-width': 2,
      },
    },
    {
      selector: 'edge.ember',
      style: {
        width: 3,
        'line-color': token('--ember-500'),
        'target-arrow-color': token('--ember-500'),
        'line-style': 'dashed',
        'line-dash-pattern': [10, 6],
        color: token('--ember-300'),
        'z-index': 10,
      },
    },
        {
      // the analyst's selection gets a pale light rim, overriding corona on flagged nodes
      selector: 'node.focus',
      style: {
        'border-color': token('--light-50'),
        'border-width': 3,
        color: token('--light-50'),
      },
    },
    {
      // everything outside the selection's direct connections recedes into shadow
      selector: '.faded',
      style: { opacity: 0.22 },
    },
  ]
}