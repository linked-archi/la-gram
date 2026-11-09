/**
 * Example questions: the `arch:Question` individuals of the loaded query
 * assets (core-queries, archimate4-queries), and how to turn one into a query
 * the SPARQL panel can run.
 *
 * ## The contract (core-question-terms.ttl)
 *
 * - The query text is in `sh:select` / `sh:construct` / `sh:ask`, without
 *   PREFIX lines (they come from `sh:prefixes` → `sh:declare`) and without a
 *   LIMIT (`arch:defaultLimit` is appended for browsing).
 * - A parameter is an `sh:parameter` whose `sh:path` local name is the
 *   variable it binds (`archq:focus` → `?focus`). It is pre-bound by inserting
 *   `VALUES ?focus { <iri> }` as the first element of the outermost WHERE
 *   group — the same place the linked-archi-query templates put
 *   `VALUES ?focus { {{FOCUS_IRI}} }`. An optional parameter left unbound
 *   stays free and the question answers for "any".
 * - Only declared parameters are bound: a result column may be called `?type`
 *   or `?view` without being a parameter.
 *
 * ## Where the questions are
 *
 * In the asset's named graph, like every metamodel document, or in the default
 * graph when a user loads a question file as data; hence
 * `{ P } UNION { GRAPH ?g { P } }` throughout.
 */

import type { RdfStore } from '../rdf-engine/interfaces.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { isSafeIri } from '../rdf-engine/graph-scope.js';

export type QuestionForm = 'select' | 'construct' | 'ask';

/** One declared parameter of a question. */
export interface QuestionParameter {
  /** The variable it binds, without `?`. */
  name: string;
  optional: boolean;
  order: number;
  description?: string;
}

/** A question, as the Examples menu and a deliverable generator need it. */
export interface Question {
  iri: string;
  /** The linked-archi-query catalogue name of its counterpart, e.g. `core/orphans`. */
  identifier?: string;
  label: string;
  description?: string;
  answers?: string;
  doesNotProve?: string;
  /** IRI of its `arch:questionStage` concept. */
  stage?: string;
  form: QuestionForm;
  /** The query text as stored, dedented. */
  text: string;
  /** Rows are findings: none means the concern is satisfied. */
  isFinding: boolean;
  severity?: string;
  defaultLimit?: number;
  concerns: string[];
  stakeholders: string[];
  viewpoints: string[];
  /** Ontologies that must be loaded for the question to mean anything. */
  metamodels: string[];
  parameters: QuestionParameter[];
  prefixes: Record<string, string>;
}

/** Parameter values: IRIs, one or several per variable. */
export type QuestionBindings = Record<string, string | string[] | undefined>;

/** A required parameter was not given. */
export class MissingParameterError extends Error {
  constructor(
    readonly question: Question,
    readonly missing: string[],
  ) {
    super(`“${question.label}” needs ${missing.map((m) => `?${m}`).join(', ')}`);
    this.name = 'MissingParameterError';
  }
}

const ARCH = NAMESPACES.arch;
const SH = NAMESPACES.sh;
const SKOS = NAMESPACES.skos;
const DCTERMS = NAMESPACES.dcterms;

const PROLOGUE = `
PREFIX arch: <${ARCH}>
PREFIX sh: <${SH}>
PREFIX skos: <${SKOS}>
PREFIX dcterms: <${DCTERMS}>
`;

/** `P` in the default graph or in any named graph, under its own graph variable. */
function anyGraph(pattern: string, g: string): string {
  return `{ ${pattern} } UNION { GRAPH ?${g} { ${pattern} } }`;
}

type Row = Record<string, { value: string } | undefined>;

function select(store: RdfStore, sparql: string): Row[] {
  const result = store.query(sparql);
  return result.type === 'bindings' ? (result.results as Row[]) : [];
}

function localName(iri: string): string {
  return iri.slice(Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/')) + 1);
}

/** Remove the common leading indentation a Turtle long string carries. */
export function dedent(text: string): string {
  const lines = text.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut)).join('\n');
}

/** Every question in the store, ordered by stage then label. */
export function listQuestions(store: RdfStore): Question[] {
  const byIri = new Map<string, Question>();

  const core = select(
    store,
    `${PROLOGUE}
    SELECT ?q ?formProp ?text WHERE {
      VALUES ?formProp { sh:select sh:construct sh:ask }
      ${anyGraph('?q a arch:Question ; ?formProp ?text .', 'g0')}
    }`,
  );
  for (const row of core) {
    const iri = row.q?.value;
    if (!iri || byIri.has(iri)) continue;
    byIri.set(iri, {
      iri,
      label: localName(iri),
      form: localName(row.formProp!.value) as QuestionForm,
      text: dedent(row.text!.value),
      isFinding: false,
      concerns: [],
      stakeholders: [],
      viewpoints: [],
      metamodels: [],
      parameters: [],
      prefixes: {},
    });
  }
  if (byIri.size === 0) return [];

  // Single-valued annotations. One OPTIONAL each, so a missing one cannot
  // empty the row and two present ones cannot multiply it.
  const scalars: [keyof Question, string][] = [
    ['label', 'skos:prefLabel'],
    ['identifier', 'dcterms:identifier'],
    ['description', 'dcterms:description'],
    ['answers', 'arch:answers'],
    ['doesNotProve', 'arch:doesNotProve'],
    ['stage', 'arch:questionStage'],
    ['severity', 'arch:findingSeverity'],
  ];
  const annotations = select(
    store,
    `${PROLOGUE}
    SELECT ?q ?p ?o WHERE {
      VALUES ?p { ${scalars.map(([, p]) => p).join(' ')} arch:resultIsFinding arch:defaultLimit
                  arch:questionAddressesConcern arch:questionTargetsStakeholder
                  arch:questionFitsViewpoint arch:requiresMetamodel }
      ${anyGraph('?q a arch:Question ; ?p ?o .', 'g1')}
    }`,
  );
  const expand = (curie: string) => {
    const [prefix, local] = curie.split(':');
    return ({ arch: ARCH, skos: SKOS, dcterms: DCTERMS } as Record<string, string>)[prefix] + local;
  };
  const scalarOf = new Map(scalars.map(([key, curie]) => [expand(curie), key]));
  for (const row of annotations) {
    const q = byIri.get(row.q!.value);
    const p = row.p!.value;
    const o = row.o!.value;
    if (!q) continue;
    const key = scalarOf.get(p);
    if (key) {
      // The first value wins; a stored label is preferred to the IRI fallback.
      if (key === 'label' ? q.label === localName(q.iri) : q[key] === undefined) (q as unknown as Record<string, unknown>)[key] = o;
    } else if (p === ARCH + 'resultIsFinding') q.isFinding = o === 'true';
    else if (p === ARCH + 'defaultLimit') q.defaultLimit = Number(o);
    else if (p === ARCH + 'questionAddressesConcern') q.concerns.push(o);
    else if (p === ARCH + 'questionTargetsStakeholder') q.stakeholders.push(o);
    else if (p === ARCH + 'questionFitsViewpoint') q.viewpoints.push(o);
    else if (p === ARCH + 'requiresMetamodel') q.metamodels.push(o);
  }

  // Parameters are blank nodes: the whole pattern stays inside one graph.
  const params = select(
    store,
    `${PROLOGUE}
    SELECT ?q ?path ?optional ?order ?description WHERE {
      ${anyGraph(
        `?q a arch:Question ; sh:parameter ?param . ?param sh:path ?path .
         OPTIONAL { ?param sh:optional ?optional }
         OPTIONAL { ?param sh:order ?order }
         OPTIONAL { ?param sh:description ?description }`,
        'g2',
      )}
    }`,
  );
  for (const row of params) {
    const q = byIri.get(row.q!.value);
    const name = localName(row.path!.value);
    if (!q || q.parameters.some((p) => p.name === name)) continue;
    q.parameters.push({
      name,
      optional: row.optional?.value === 'true',
      order: Number(row.order?.value ?? q.parameters.length + 1),
      ...(row.description ? { description: row.description.value } : {}),
    });
  }

  const prefixes = select(
    store,
    `${PROLOGUE}
    SELECT ?q ?prefix ?namespace WHERE {
      ${anyGraph(
        `?q a arch:Question ; sh:prefixes ?declarer . ?declarer sh:declare ?d .
         ?d sh:prefix ?prefix ; sh:namespace ?namespace .`,
        'g3',
      )}
    }`,
  );
  for (const row of prefixes) {
    const q = byIri.get(row.q!.value);
    if (q) q.prefixes[row.prefix!.value] ??= row.namespace!.value;
  }

  const stageOrder = ['orientation', 'resolution', 'discovery', 'analysis', 'enrichment', 'quality', 'views'];
  const rank = (q: Question) => {
    const i = stageOrder.findIndex((s) => q.stage?.toLowerCase().endsWith(`${s}stage`));
    return i < 0 ? stageOrder.length : i;
  };
  return [...byIri.values()]
    .map((q) => ({ ...q, parameters: q.parameters.sort((a, b) => a.order - b.order) }))
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/**
 * The questions worth offering: those whose metamodels are loaded, the ones
 * fitting `viewpoint` (the active view's) first.
 */
export function offeredQuestions(
  questions: Question[],
  loadedOntologies: ReadonlySet<string>,
  viewpoint?: string,
): Question[] {
  const available = questions.filter((q) => q.metamodels.every((m) => loadedOntologies.has(m)));
  if (!viewpoint) return available;
  const fits = (q: Question) => (q.viewpoints.includes(viewpoint) ? 0 : 1);
  return [...available].sort((a, b) => fits(a) - fits(b));
}

/**
 * Blank out strings, IRIs and comments, keeping every offset, so keywords and
 * braces can be found in what remains.
 */
export function maskSparql(sparql: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return sparql
    .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, blank)
    .replace(/<[^<>"{}|^`\\\s]*>/g, blank)
    .replace(/#[^\n]*/g, blank);
}

/** Offset of the `{` opening the outermost WHERE group, or -1. */
function whereGroupStart(sparql: string): number {
  const masked = maskSparql(sparql);
  const where = /\bWHERE\b/i.exec(masked);
  return masked.indexOf('{', where ? where.index + where[0].length : 0);
}

/**
 * Pre-bind variables: `VALUES ?name { <iri> … }` as the first element of the
 * outermost WHERE group. Unbound (undefined or empty) entries are left out.
 */
export function prebind(sparql: string, bindings: QuestionBindings): string {
  const clauses: string[] = [];
  for (const [name, value] of Object.entries(bindings)) {
    const iris = (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
    if (iris.length === 0) continue;
    if (!/^\w+$/.test(name)) throw new Error(`Not a variable name: ${name}`);
    for (const iri of iris) if (!isSafeIri(iri)) throw new Error(`Not an IRI that can be bound: ${iri}`);
    clauses.push(`VALUES ?${name} { ${iris.map((i) => `<${i}>`).join(' ')} }`);
  }
  if (clauses.length === 0) return sparql;
  const at = whereGroupStart(sparql);
  if (at < 0) throw new Error('The query has no WHERE group to pre-bind into');
  return `${sparql.slice(0, at + 1)}\n  ${clauses.join('\n  ')}${sparql.slice(at + 1)}`;
}

/**
 * The full query text for a question: prefixes, the question with its declared
 * parameters pre-bound, and — unless `limit` is `null` — a LIMIT.
 */
export function buildQuery(
  question: Question,
  bindings: QuestionBindings = {},
  options: { limit?: number | null } = {},
): string {
  const has = (v: QuestionBindings[string]) => (Array.isArray(v) ? v.length > 0 : !!v);
  const missing = question.parameters.filter((p) => !p.optional && !has(bindings[p.name])).map((p) => p.name);
  if (missing.length > 0) throw new MissingParameterError(question, missing);

  const own: QuestionBindings = {};
  for (const p of question.parameters) if (has(bindings[p.name])) own[p.name] = bindings[p.name];

  const prologue = Object.entries(question.prefixes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, ns]) => `PREFIX ${prefix}: <${ns}>`)
    .join('\n');
  let body = prebind(question.text, own);
  const limit = options.limit === undefined ? question.defaultLimit : options.limit;
  if (question.form !== 'ask' && limit && !/\bLIMIT\s+\d+\s*$/i.test(maskSparql(body))) body += `\nLIMIT ${limit}`;
  return `${prologue}\n\n${body}\n`;
}
