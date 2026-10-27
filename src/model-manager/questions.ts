/**
 * Model questions: the `arch:ModelQuestion` individuals of the loaded question
 * sets — the core set, and each metamodel's (`arch:hasQuestionSet`) — and how
 * to turn one into a query the SPARQL tab can run.
 *
 * ## The contract (meta's DD-33)
 *
 * - The query text is in `sh:select` / `sh:construct` / `sh:ask`, without
 *   PREFIX lines (they come from `sh:prefixes` → `sh:declare`) and without a
 *   LIMIT (`arch:defaultLimit` is appended for browsing).
 * - A parameter is an `sh:parameter` whose `sh:path` local name is the
 *   variable it binds (`arch:focus` → `?focus`). It is pre-bound by inserting
 *   `VALUES ?focus { <iri> }` as the first element of the outermost WHERE
 *   group. An optional parameter left unbound stays free and the question
 *   answers for "any"; a question whose required parameter is unbound is not
 *   asked.
 * - Only declared parameters are bound: a result column may be called `?type`
 *   or `?view` without being a parameter.
 * - A finding question (`arch:resultIsFinding`) lists problems against the
 *   concerns it addresses; `arch:findingFocus` names the column holding the
 *   concept each is about, `arch:findingSeverity` how serious it is.
 *
 * ## Where the questions are
 *
 * In their question set's named graph, as every metamodel document, or in the
 * default graph when a question file is loaded as data; hence
 * `{ P } UNION { GRAPH ?g { P } }` throughout.
 */

import { DataFactory } from 'n3';
import type { NamedNode } from '@rdfjs/types';
import type { RdfStore, ValidationResult, ValidationSeverity } from '../rdf-engine/interfaces.js';
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

/** A model question, as the Questions menu, the model checks and a deliverable generator need it. */
export interface ModelQuestion {
  iri: string;
  /** The linked-archi-query catalogue name of its counterpart, e.g. `core/orphans`. */
  identifier?: string;
  /** The question itself. */
  label: string;
  description?: string;
  /** What one row means. */
  answers?: string;
  /** What the answer does not settle. */
  doesNotProve?: string;
  /** IRI of its `arch:questionStage` concept. */
  stage?: string;
  form: QuestionForm;
  /** The query text as stored, dedented. */
  text: string;
  /** Rows are findings: none means the concerns it addresses are met. */
  isFinding: boolean;
  /** `sh:Info`, `sh:Warning` or `sh:Violation`, for a finding. */
  severity?: string;
  /** The result column naming the concept each finding is about, without `?`. */
  findingFocus?: string;
  defaultLimit?: number;
  concerns: string[];
  stakeholders: string[];
  viewpoints: string[];
  purposes: string[];
  /** Ontologies that must be loaded for the question to mean anything. */
  metamodels: string[];
  parameters: QuestionParameter[];
  prefixes: Record<string, string>;
}

/** Parameter values: IRIs, one or several per variable. */
export type QuestionBindings = Record<string, string | readonly string[] | undefined>;

/** A required parameter was not given. */
export class MissingParameterError extends Error {
  constructor(
    readonly question: ModelQuestion,
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

/** The order an investigation moves through (`arch:QuestionStageScheme`). */
export const QUESTION_STAGES = [
  'orientation',
  'resolution',
  'discovery',
  'analysis',
  'enrichment',
  'quality',
  'views',
] as const;

/** The stage a question is in, by its concept's local name (`arch:QualityStage` → `quality`). */
export function stageOf(question: ModelQuestion): string | undefined {
  const local = question.stage ? localName(question.stage).toLowerCase() : undefined;
  return QUESTION_STAGES.find((s) => local === `${s}stage`);
}

/** `P` in the default graph or in any named graph, under its own graph variable. */
function anyGraph(pattern: string, g: string): string {
  return `{ ${pattern} } UNION { GRAPH ?${g} { ${pattern} } }`;
}

type Row = Record<string, { value: string; language?: string } | undefined>;

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

/** Every model question in the store, ordered by stage then label. */
export function listQuestions(store: RdfStore): ModelQuestion[] {
  const byIri = new Map<string, ModelQuestion>();

  const core = select(
    store,
    `${PROLOGUE}
    SELECT ?q ?formProp ?text WHERE {
      VALUES ?formProp { sh:select sh:construct sh:ask }
      ${anyGraph('?q a arch:ModelQuestion ; ?formProp ?text .', 'g0')}
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
      purposes: [],
      metamodels: [],
      parameters: [],
      prefixes: {},
    });
  }
  if (byIri.size === 0) return [];

  // Single-valued annotations. One OPTIONAL each, so a missing one cannot
  // empty the row and two present ones cannot multiply it.
  const scalars: [keyof ModelQuestion, string][] = [
    ['label', 'skos:prefLabel'],
    ['identifier', 'dcterms:identifier'],
    ['description', 'dcterms:description'],
    ['answers', 'arch:answers'],
    ['doesNotProve', 'arch:doesNotProve'],
    ['stage', 'arch:questionStage'],
    ['severity', 'arch:findingSeverity'],
    ['findingFocus', 'arch:findingFocus'],
  ];
  const lists: [keyof ModelQuestion, string][] = [
    ['concerns', 'arch:questionAddressesConcern'],
    ['stakeholders', 'arch:questionTargetsStakeholder'],
    ['viewpoints', 'arch:questionFitsViewpoint'],
    ['purposes', 'arch:questionHasPurpose'],
    ['metamodels', 'arch:requiresMetamodel'],
  ];
  const annotations = select(
    store,
    `${PROLOGUE}
    SELECT ?q ?p ?o WHERE {
      VALUES ?p { ${[...scalars, ...lists].map(([, p]) => p).join(' ')} arch:resultIsFinding arch:defaultLimit }
      ${anyGraph('?q a arch:ModelQuestion ; ?p ?o .', 'g1')}
    }`,
  );
  const expand = (curie: string) => {
    const [prefix, local] = curie.split(':');
    return ({ arch: ARCH, skos: SKOS, dcterms: DCTERMS } as Record<string, string>)[prefix!] + local;
  };
  const scalarOf = new Map(scalars.map(([key, curie]) => [expand(curie), key]));
  const listOf = new Map(lists.map(([key, curie]) => [expand(curie), key]));
  for (const row of annotations) {
    const q = byIri.get(row.q!.value);
    if (!q) continue;
    const p = row.p!.value;
    const o = row.o!;
    const scalar = scalarOf.get(p);
    const list = listOf.get(p);
    if (scalar) {
      // A stored label beats the IRI fallback; English beats another language; else the first wins.
      const current = q[scalar] as string | undefined;
      const replace =
        scalar === 'label'
          ? q.label === localName(q.iri) || (o.language === 'en' && current !== undefined)
          : current === undefined || o.language === 'en';
      if (replace) (q as unknown as Record<string, unknown>)[scalar] = o.value;
    } else if (list) {
      const values = q[list] as string[];
      if (!values.includes(o.value)) values.push(o.value);
    } else if (p === ARCH + 'resultIsFinding') q.isFinding = o.value === 'true';
    else if (p === ARCH + 'defaultLimit') q.defaultLimit = Number(o.value);
  }

  // Parameters are blank nodes: the whole pattern stays inside one graph.
  const params = select(
    store,
    `${PROLOGUE}
    SELECT ?q ?path ?optional ?order ?description WHERE {
      ${anyGraph(
        `?q a arch:ModelQuestion ; sh:parameter ?param . ?param sh:path ?path .
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
      ${anyGraph('?q a arch:ModelQuestion ; sh:prefixes ?declarer .', 'g3')}
      ${anyGraph('?declarer sh:declare ?d . ?d sh:prefix ?prefix ; sh:namespace ?namespace .', 'g4')}
    }`,
  );
  for (const row of prefixes) {
    const q = byIri.get(row.q!.value);
    if (q) q.prefixes[row.prefix!.value] ??= row.namespace!.value;
  }

  const rank = (q: ModelQuestion) => {
    const i = QUESTION_STAGES.indexOf(stageOf(q) as (typeof QUESTION_STAGES)[number]);
    return i < 0 ? QUESTION_STAGES.length : i;
  };
  return [...byIri.values()]
    .map((q) => ({ ...q, parameters: q.parameters.sort((a, b) => a.order - b.order) }))
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/**
 * The questions worth offering: those whose ontologies are loaded, the ones
 * fitting `viewpoint` (the open view's) first.
 */
export function offeredQuestions(
  questions: readonly ModelQuestion[],
  loadedOntologies: ReadonlySet<string>,
  viewpoint?: string,
): ModelQuestion[] {
  const available = questions.filter((q) => q.metamodels.every((m) => loadedOntologies.has(m)));
  if (!viewpoint) return available;
  const fits = (q: ModelQuestion) => (q.viewpoints.includes(viewpoint) ? 0 : 1);
  return [...available].sort((a, b) => fits(a) - fits(b));
}

const bound = (v: QuestionBindings[string]) => (Array.isArray(v) ? v.length > 0 : !!v);

/** The required parameters `bindings` leaves unbound: why the question cannot be asked yet. */
export function missingParameters(question: ModelQuestion, bindings: QuestionBindings): string[] {
  return question.parameters.filter((p) => !p.optional && !bound(bindings[p.name])).map((p) => p.name);
}

/** What a modeller does in the workbench to bind each parameter. */
export const PARAMETER_HINTS: Readonly<Record<string, string>> = {
  focus: 'select an element',
  model: 'open a model',
  view: 'open a view',
  viewpoint: 'open a view that follows a viewpoint',
  conceptType: 'pick a type in the palette',
  from: 'select two elements',
  to: 'select two elements',
};

/** What to do before the question can be asked ("Select an element"); none when it can be. */
export function whatToSelect(question: ModelQuestion, bindings: QuestionBindings): string | undefined {
  const hints = [...new Set(missingParameters(question, bindings).map((p) => PARAMETER_HINTS[p] ?? `bind ?${p}`))];
  if (hints.length === 0) return undefined;
  const text = hints.join(' and ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The viewpoint a view of the question's answer follows: the one viewpoint it
 * fits, or else the viewpoint it was asked about (`?viewpoint`); none when
 * that is not one.
 */
export function viewpointOfAnswer(question: ModelQuestion, bindings: QuestionBindings = {}): string | undefined {
  if (question.viewpoints.length === 1) return question.viewpoints[0];
  if (question.viewpoints.length > 1 || !question.parameters.some((p) => p.name === 'viewpoint')) return undefined;
  const value = bindings.viewpoint;
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.length === 1 ? values[0] : undefined;
}

/** The outcome of running the model checks: findings as validation results, and what did not run. */
export interface ModelCheckRun {
  /** One per finding: the concept in the question's `arch:findingFocus` column, once per question. */
  results: ValidationResult[];
  /** The checks that ran. */
  ran: ModelQuestion[];
  /** The checks that could not run, and why. */
  failed: Array<{ question: ModelQuestion; reason: string }>;
  /** The checks that stopped at their `arch:defaultLimit`: there may be more findings. */
  capped: ModelQuestion[];
}

const SEVERITIES: Record<string, ValidationSeverity> = {
  [SH + 'Violation']: 'Violation',
  [SH + 'Warning']: 'Warning',
  [SH + 'Info']: 'Info',
};

/**
 * Ask each finding question and turn its rows into validation results: the
 * concept from its `arch:findingFocus` column, the severity from
 * `arch:findingSeverity` (a warning when it states none), the question as the
 * message and its IRI as the source shape. A question whose required
 * parameter `bindings` leaves unbound, or whose query fails, is reported in
 * `failed`, not dropped.
 */
export function runModelChecks(
  store: RdfStore,
  questions: readonly ModelQuestion[],
  bindings: QuestionBindings = {},
): ModelCheckRun {
  const run: ModelCheckRun = { results: [], ran: [], failed: [], capped: [] };
  for (const question of questions) {
    if (!question.isFinding) continue;
    const missing = whatToSelect(question, bindings);
    if (missing) {
      run.failed.push({ question, reason: missing });
      continue;
    }
    const focus = question.findingFocus;
    if (!focus || question.form !== 'select') {
      run.failed.push({ question, reason: focus ? 'Not a SELECT question' : 'It names no arch:findingFocus column' });
      continue;
    }
    let rows: Array<Record<string, { termType?: string; value: string } | undefined>>;
    try {
      const result = store.query(buildQuery(question, bindings));
      rows = result.type === 'bindings' ? result.results : [];
    } catch (err: unknown) {
      run.failed.push({ question, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    run.ran.push(question);
    if (question.defaultLimit && rows.length >= question.defaultLimit) run.capped.push(question);
    const seen = new Set<string>();
    for (const row of rows) {
      const term = row[focus];
      if (term?.termType !== 'NamedNode' || seen.has(term.value)) continue;
      seen.add(term.value);
      run.results.push({
        focusNode: DataFactory.namedNode(term.value) as unknown as NamedNode,
        // No property: a finding is about the concept.
        resultPath: DataFactory.namedNode('') as unknown as NamedNode,
        sourceShape: DataFactory.namedNode(question.iri) as unknown as NamedNode,
        message: question.label,
        severity: SEVERITIES[question.severity ?? ''] ?? 'Warning',
      });
    }
  }
  return run;
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
    const iris = (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean) as string[];
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
  question: ModelQuestion,
  bindings: QuestionBindings = {},
  options: { limit?: number | null } = {},
): string {
  const missing = missingParameters(question, bindings);
  if (missing.length > 0) throw new MissingParameterError(question, missing);

  const own: QuestionBindings = {};
  for (const p of question.parameters) if (bound(bindings[p.name])) own[p.name] = bindings[p.name];

  const prologue = Object.entries(question.prefixes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, ns]) => `PREFIX ${prefix}: <${ns}>`)
    .join('\n');
  let body = prebind(question.text, own);
  const limit = options.limit === undefined ? question.defaultLimit : options.limit;
  if (question.form !== 'ask' && limit && !/\bLIMIT\s+\d+\s*$/i.test(maskSparql(body))) body += `\nLIMIT ${limit}`;
  return `${prologue}\n\n${body}\n`;
}
