import { describe, it, expect } from 'vitest';
import { RdfRenderer, RENDER_DEFAULTS, type RenderableElement } from '../rdf-renderer.js';

function createTestElement(overrides?: Partial<RenderableElement>): RenderableElement {
  return {
    id: 'elem-1',
    iri: 'https://example.org/model/elem-1',
    typeIri: 'arch:BusinessProcess',
    label: 'My Process',
    x: 100,
    y: 200,
    width: 130,
    height: 60,
    ...overrides,
  };
}

describe('RdfRenderer', () => {
  const renderer = new RdfRenderer();

  it('renders an element as SVG with correct transform', () => {
    const element = createTestElement();
    const svg = renderer.renderElement(element);

    expect(svg).toContain('translate(100, 200)');
  });

  it('renders a rectangle with correct dimensions', () => {
    const element = createTestElement();
    const svg = renderer.renderElement(element);

    expect(svg).toContain('width="130"');
    expect(svg).toContain('height="60"');
  });

  it('renders the label text', () => {
    const element = createTestElement({ label: 'Customer Portal' });
    const svg = renderer.renderElement(element);

    expect(svg).toContain('Customer Portal');
    expect(svg).toContain('text-anchor="middle"');
  });

  it('renders icon when iconUrl is provided', () => {
    const element = createTestElement({ iconUrl: 'https://example.org/icon.svg' });
    const svg = renderer.renderElement(element);

    expect(svg).toContain('<image');
    expect(svg).toContain('href="https://example.org/icon.svg"');
  });

  it('does not render icon when iconUrl is absent', () => {
    const element = createTestElement({ iconUrl: undefined });
    const svg = renderer.renderElement(element);

    expect(svg).not.toContain('<image');
  });

  it('includes data-element-iri attribute', () => {
    const element = createTestElement();
    const svg = renderer.renderElement(element);

    expect(svg).toContain(`data-element-iri="${element.iri}"`);
  });

  it('escapes XML special characters in label', () => {
    const element = createTestElement({ label: 'A & B <C>' });
    const svg = renderer.renderElement(element);

    expect(svg).toContain('A &amp; B &lt;C&gt;');
    expect(svg).not.toContain('A & B <C>');
  });

  it('getElementStyle returns correct style info', () => {
    const withIcon = createTestElement({ iconUrl: 'icon.svg' });
    const withoutIcon = createTestElement({ iconUrl: undefined });

    const styleWithIcon = renderer.getElementStyle(withIcon);
    const styleWithoutIcon = renderer.getElementStyle(withoutIcon);

    expect(styleWithIcon.hasIcon).toBe(true);
    expect(styleWithoutIcon.hasIcon).toBe(false);
    expect(styleWithIcon.fillColor).toBe(RENDER_DEFAULTS.fillColor);
    expect(styleWithIcon.strokeColor).toBe(RENDER_DEFAULTS.strokeColor);
  });

  it('uses render defaults for styling', () => {
    const element = createTestElement();
    const svg = renderer.renderElement(element);

    expect(svg).toContain(`fill="${RENDER_DEFAULTS.fillColor}"`);
    expect(svg).toContain(`stroke="${RENDER_DEFAULTS.strokeColor}"`);
    expect(svg).toContain(`rx="${RENDER_DEFAULTS.cornerRadius}"`);
  });
});
