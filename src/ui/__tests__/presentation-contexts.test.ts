import { describe, it, expect } from 'vitest';
import { contextChoices } from '../presentation-contexts.js';

describe('the presentation contexts offered', () => {
  it('each by its name; two that share one — ArchiMate 3.2’s and 4.0’s — each with its scheme’s', () => {
    expect(
      contextChoices([
        { iri: 'am4pc:DeveloperContext', label: 'Developer / Engineering', schemeLabel: 'ArchiMate 4.0 Presentation Contexts' },
        { iri: 'am4pc:ArchitectContext', label: 'Architect', schemeLabel: 'ArchiMate 4.0 Presentation Contexts' },
        { iri: 'ampc:DeveloperContext', label: 'Developer / Engineering', schemeLabel: 'ArchiMate Presentation Contexts' },
      ]),
    ).toEqual([
      { iri: 'am4pc:DeveloperContext', label: 'Developer / Engineering (ArchiMate 4.0 Presentation Contexts)' },
      { iri: 'am4pc:ArchitectContext', label: 'Architect' },
      { iri: 'ampc:DeveloperContext', label: 'Developer / Engineering (ArchiMate Presentation Contexts)' },
    ]);
  });
});
