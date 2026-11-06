// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { ElementTypeInfo, RelationshipTypeInfo } from '../../../metamodel-manager/interfaces.js';
import {
  RdfAppendMenuProvider,
  RdfAppendRelationshipMenuProvider,
  appendEntryId,
  unambiguousRelationship,
  type AppendMenuContext,
  type AppendSupport,
  type ExistingRelationship,
} from '../rdf-append-menu-provider.js';
import type { AppendTarget } from '../relationship-resolution.js';

const MM = 'https://example.org/mm#';
const rel = (name: string, iconUrl?: string): RelationshipTypeInfo => ({
  iri: MM + name,
  label: name,
  domainTypes: [],
  rangeTypes: [],
  ...(iconUrl ? { iconUrl } : {}),
});
const FLOW = rel('Flow');
const SERVING = rel('Serving', 'archimate4/icons/serving.svg');
const ASSIGNMENT = rel('Assignment');
const ASSOCIATION = rel('Association');
const type = (name: string, iconUrl?: string): ElementTypeInfo => ({
  iri: MM + name,
  label: name,
  isAbstract: false,
  ...(iconUrl ? { iconUrl } : {}),
});

const CONTEXT: AppendMenuContext = { sourceIri: 'https://example.org/m/a', sourceTypeIri: MM + 'Actor', diagramElement: {} };

function provider(targets: AppendTarget[]) {
  const support: AppendSupport = { place: vi.fn(), drag: vi.fn(), chooseRelationship: vi.fn() };
  const menu = new RdfAppendMenuProvider(() => CONTEXT, () => targets, support);
  return { menu, support, entries: menu.getPopupMenuEntries({}) };
}

describe('unambiguousRelationship', () => {
  it('decides alone when one specific relationship is permitted, Association aside', () => {
    expect(unambiguousRelationship([ASSIGNMENT, ASSOCIATION])).toBe(ASSIGNMENT);
    expect(unambiguousRelationship([ASSOCIATION])).toBe(ASSOCIATION);
    expect(unambiguousRelationship([FLOW, SERVING, ASSOCIATION])).toBeUndefined();
  });

  it('counts a directed association as an association, not as a choice', () => {
    const directed = { ...rel('DirectedAssociation'), label: 'Directed Association' };
    expect(unambiguousRelationship([ASSIGNMENT, ASSOCIATION, directed])).toBe(ASSIGNMENT);
  });
});

describe('RdfAppendMenuProvider', () => {
  const targets: AppendTarget[] = [
    { type: type('Role', 'archimate4/icons/business-role.svg'), category: 'Business', relationships: [ASSIGNMENT, ASSOCIATION] },
    { type: type('Component', 'https://meta.linked.archi/archimate4/icons/app.svg'), category: 'Application', relationships: [FLOW, SERVING, ASSOCIATION] },
  ];

  it('shows each type’s icon as a URL the page can load', () => {
    const { entries } = provider(targets);
    // Asset-root-relative paths resolve under the bundled assets, as in the palette.
    expect(entries[appendEntryId(MM + 'Role')].imageUrl).toMatch(/\/assets\/archimate4\/icons\/business-role\.svg$/);
    // Published URLs are used as they are.
    expect(entries[appendEntryId(MM + 'Component')].imageUrl).toBe('https://meta.linked.archi/archimate4/icons/app.svg');
  });

  it('creates the one specific relationship without asking', () => {
    const { entries, support } = provider(targets);
    const role = entries[appendEntryId(MM + 'Role')];
    expect(role.description).toBe('via Assignment');
    role.action.click({});
    expect(support.place).toHaveBeenCalledWith(CONTEXT, MM + 'Role', MM + 'Assignment');
    expect(support.chooseRelationship).not.toHaveBeenCalled();
  });

  it('asks when several specific relationships are permitted', () => {
    const { entries, support } = provider(targets);
    const component = entries[appendEntryId(MM + 'Component')];
    expect(component.description).toBe('choose: Flow / Serving');
    component.action.click({});
    expect(support.chooseRelationship).toHaveBeenCalledWith(CONTEXT, targets[1], {});
    expect(support.place).not.toHaveBeenCalled();
  });
});

describe('RdfAppendRelationshipMenuProvider', () => {
  it('lists the permitted relationships, Association last, and creates the one picked', () => {
    const place = vi.fn();
    const step = new RdfAppendRelationshipMenuProvider({ place });
    expect(step.getPopupMenuEntries({})).toEqual({});

    const target: AppendTarget = { type: type('Component'), category: 'Application', relationships: [FLOW, ASSOCIATION, SERVING] };
    step.pending = { context: CONTEXT, target };
    const entries = step.getPopupMenuEntries({});
    expect(Object.values(entries).map((e) => e.label)).toEqual(['Flow', 'Serving', 'Association']);
    expect(entries[appendEntryId(MM + 'Serving')].imageUrl).toMatch(/\/assets\/archimate4\/icons\/serving\.svg$/);

    entries[appendEntryId(MM + 'Serving')].action.click({});
    expect(place).toHaveBeenCalledWith(CONTEXT, MM + 'Component', MM + 'Serving');
  });
});

describe('the Existing relationships tab', () => {
  const existing: ExistingRelationship[] = [
    {
      relationshipIri: 'https://example.org/m/relationship-1',
      typeLabel: 'Serving',
      direction: 'out',
      otherIri: 'https://example.org/m/element-shop',
      otherLabel: 'Web Shop',
      otherTypeLabel: 'Application Component',
      otherIconUrl: 'archimate4/icons/application-component.svg',
      otherInView: false,
      drawn: false,
    },
    {
      relationshipIri: 'https://example.org/m/relationship-2',
      typeLabel: 'Assignment',
      direction: 'in',
      otherIri: 'https://example.org/m/element-clerk',
      otherLabel: 'Clerk',
      otherInView: true,
      drawn: true,
    },
  ];
  const newTargets: AppendTarget[] = [{ type: type('Role'), category: 'Business', relationships: [ASSIGNMENT] }];

  function mount(targets: AppendTarget[], rows: ExistingRelationship[]) {
    const support: AppendSupport = {
      place: vi.fn(),
      drag: vi.fn(),
      chooseRelationship: vi.fn(),
      showExisting: vi.fn(),
      dragExisting: vi.fn(),
      refresh: vi.fn(),
    };
    const menu = new RdfAppendMenuProvider(() => CONTEXT, () => targets, support, () => rows);
    return { menu, support };
  }

  it('shows two tabs — new elements, existing relationships with their count — New first', () => {
    const { menu, support } = mount(newTargets, existing);
    menu.startOn({});
    const tabs = menu.getPopupMenuHeaderEntries({});
    expect(tabs.map((t) => [t.label, t.active])).toEqual([
      ['New element', true],
      ['Existing relationships (2)', false],
    ]);
    expect(Object.values(menu.getPopupMenuEntries({})).map((e) => e.label)).toEqual(['Role']);

    tabs[1].action();
    expect(menu.tab).toBe('existing');
    expect(support.refresh).toHaveBeenCalled();
  });

  it('lists what is not in the view first, with the direction and type of each relationship', () => {
    const { menu, support } = mount(newTargets, existing);
    menu.tab = 'existing';
    const entries = Object.values(menu.getPopupMenuEntries({}));
    expect(entries.map((e) => [e.label, e.description, e.group?.name])).toEqual([
      ['Web Shop', '→ Serving · Application Component', 'Not in this view'],
      ['Clerk', '← Assignment', 'In this view'],
    ]);
    expect(entries[0].imageUrl).toMatch(/\/assets\/archimate4\/icons\/application-component\.svg$/);
    entries[0].action.click({});
    expect(support.showExisting).toHaveBeenCalledWith(CONTEXT, existing[0]);
    entries[0].action.dragstart({ x: 1 });
    expect(support.dragExisting).toHaveBeenCalledWith(CONTEXT, existing[0], { x: 1 });
    expect(menu.getEmptyPlaceholder()).toMatch(/No relationships/);
  });

  it('opens on Existing relationships when nothing new may be appended', () => {
    const { menu } = mount([], existing);
    menu.startOn({});
    expect(menu.tab).toBe('existing');
  });

  it('has no tabs — and so no Append button — when there is nothing either way', () => {
    const { menu } = mount([], []);
    expect(menu.getPopupMenuHeaderEntries({})).toEqual([]);
    expect(menu.getPopupMenuEntries({})).toEqual({});
  });
});

