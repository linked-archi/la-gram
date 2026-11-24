/**
 * The provenance of edits (meta's DD-27, *What a modeller records of its edits*; Req 9.16): who changed a
 * concept, when, and with which la-gram — recorded as the concept is edited, inside the edit, so that what
 * la-gram saves is what it shows and undo takes a stamp back with its change.
 *
 * - **On the concept** (the model, an element, a relationship, a view): `dcterms:created` when it is made,
 *   `dcterms:modified` at every change to it. A change to a shape, a style, a route or a name is a change to
 *   the view or the element it is part of; every change is one to the model too. A value set by hand in the
 *   same edit stays.
 * - **In the provenance graph** (`{ns}graph/provenance` when saved): the concept's `prov:wasGeneratedBy`, the
 *   editing activity that last changed it, and `prov:generatedAtTime`; the activity — one user's edits in
 *   one la-gram, from the first change after the model is opened or saved to the next save — with its start
 *   and end, `prov:wasAssociatedWith` la-gram at its version and the user; la-gram, a
 *   `prov:SoftwareAgent`; the user, a `prov:Person` with their name, email address and Git account
 *   (`schema:sameAs` its page, `schema:alternateName` its username) as far as la-gram knows them.
 *
 * Minimal on purpose: four statements a concept, five an activity, la-gram and each user once. An activity
 * no concept names any more is removed in the edit that leaves it unnamed, and so is a user or a la-gram
 * version no activity names. What exactly changed in a concept is what checkpoints and Git compare.
 *
 * The activities and the users are named in the model's namespace, `{ns}provenance/edit-{id}` and
 * `{ns}provenance/user-{id}` (meta's *IRI Minting*, *Provenance of edits*): the word is for a person reading
 * the Turtle, the id is opaque — an activity's a random UUID, a user's the digest of their Git account's page,
 * else of their email address, else of their name, so that the IRI carries nothing personal and one user is
 * one resource on every machine. la-gram at a version is an IRI of its own, the same in every model:
 * {@link modellerIri}, the page of that version.
 *
 * What is not an edit is not stamped: opening, importing, merging, restoring a version, moving the model to
 * another namespace, undo and redo, a collaborator's changes (`ObservableRdfStore.withoutStamps`, origins).
 */

import { DataFactory, Store as N3Store } from 'n3';
import type { NamedNode, Quad, Term } from '@rdfjs/types';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import type { RdfDiff } from '../rdf-engine/observable-store.js';
import type { RdfStore } from '../rdf-engine/interfaces.js';
import { dateTimeLiteral, IRI } from './vocabulary.js';
import { keyDigest } from './short-hash.js';
import { uuid } from '../rdf-engine/iri.js';

const PROV = NAMESPACES.prov;
const SCHEMA = NAMESPACES.schema;
const { namedNode, literal, quad, defaultGraph } = DataFactory;
const MODEL = defaultGraph() as unknown as NamedNode;
const nn = (iri: string) => namedNode(iri) as unknown as NamedNode;

/** la-gram's home: the web app, its documentation, and a page for each version. */
export const LA_GRAM_HOME = 'https://app.linked.archi/la-gram/';

/** la-gram at `version`, as the agent of its edits: that version's page; a development build's own. */
export function modellerIri(version: string): string {
  return version ? `${LA_GRAM_HOME}v${version}` : `${LA_GRAM_HOME}development`;
}

/** The version this build says it is; none under Vitest, which defines no build. */
export function buildVersion(): string {
  return typeof __LA_GRAM_BUILD__ === 'object' && __LA_GRAM_BUILD__ ? __LA_GRAM_BUILD__.version : '';
}

export const PROVENANCE_TERMS = {
  activity: PROV + 'Activity',
  person: PROV + 'Person',
  softwareAgent: PROV + 'SoftwareAgent',
  wasGeneratedBy: PROV + 'wasGeneratedBy',
  generatedAtTime: PROV + 'generatedAtTime',
  startedAtTime: PROV + 'startedAtTime',
  endedAtTime: PROV + 'endedAtTime',
  wasAssociatedWith: PROV + 'wasAssociatedWith',
  softwareApplication: SCHEMA + 'SoftwareApplication',
  name: SCHEMA + 'name',
  email: SCHEMA + 'email',
  sameAs: SCHEMA + 'sameAs',
  alternateName: SCHEMA + 'alternateName',
  softwareVersion: SCHEMA + 'softwareVersion',
} as const;
const P = PROVENANCE_TERMS;

/** What la-gram itself writes as it stamps: a change to these alone is no edit. */
const STAMPS = new Set([IRI.dctermsModified, IRI.dctermsCreated, P.wasGeneratedBy, P.generatedAtTime]);

/** Links from a resource to what it is part of in a folder, never to a part of its own. */
const NOT_PART_OF = new Set([
  NAMESPACES.dcterms + 'isPartOf',
  SCHEMA + 'item',
  SCHEMA + 'itemListElement',
]);

/** A Git account, as its host reports it (`GitHostProvider.currentAccount`). */
export interface GitAccount {
  /** The account's page: `https://gitlab.com/ada`. */
  url: string;
  /** Its username: `ada`. */
  username?: string;
  /** The name it shows. */
  name?: string;
  /** The email address it shows, where it shows one. */
  email?: string;
}

/** A Git account as la-gram shows it (*Settings › You*, *Model settings*): `ada · https://gitlab.com/ada`. */
export function accountText(account: GitAccount): string {
  return [account.username, account.url].filter(Boolean).join(' · ');
}

/** Who is editing: the name, email address and Git account recorded with the edits, where known. */
export interface Editor {
  name?: string;
  email?: string;
  /** Their account on the Git host the model is kept on: its page and username. */
  account?: Pick<GitAccount, 'url' | 'username'>;
}

/** What names a user, most lasting first: their account's page, else their address, lower-cased, else their name. */
export function editorKey(editor: Editor | undefined): string | undefined {
  return editor?.account?.url?.trim() || editor?.email?.trim().toLowerCase() || editor?.name?.trim() || undefined;
}

export interface EditProvenanceOptions {
  /** Actual calling application (KReq 8.3); absent retains the legacy la-gram identity. */
  software?: { iri: string; name: string; version?: string };
  /** The open model's IRI. */
  modelIri(): string | undefined;
  /** The open model's namespace, which activities and users are named in. */
  namespace(): string | undefined;
  /** Who is editing now; nobody known, only la-gram is recorded. */
  editor(): Editor | undefined;
  /** la-gram's version; the build's by default. */
  version?: string;
  /** The clock (tests). */
  now?(): Date;
  /** A random id (tests). */
  uuid?(): string;
}

/** Whether a statement is provenance: a PROV property, or about a resource PROV types (an activity, an agent…). */
export function isProvenanceStatement(q: Quad, provenanceSubjects: ReadonlySet<string>): boolean {
  return q.predicate.value.startsWith(PROV) || provenanceSubjects.has(q.subject.value);
}

/** The resources among `quads` that a PROV class types: activities, agents, entities, bundles, associations. */
export function provenanceSubjects(quads: Iterable<Quad>): Set<string> {
  const subjects = new Set<string>();
  for (const q of quads) {
    if (q.predicate.value === IRI.rdfType && q.object.value.startsWith(PROV)) subjects.add(q.subject.value);
  }
  return subjects;
}

/** Records the provenance of local edits as they are made (see the module's comment). */
export class EditProvenance {
  private activity: string | undefined;
  private readonly version: string;
  private readonly now: () => Date;
  private readonly uuid: () => string;

  constructor(
    private readonly store: RdfStore,
    private readonly options: EditProvenanceOptions,
  ) {
    this.version = options.software?.version ?? options.version ?? buildVersion();
    this.now = options.now ?? (() => new Date());
    this.uuid = options.uuid ?? uuid;
  }

  /** la-gram's IRI as this build records it. */
  get agent(): string {
    return this.options.software?.iri ?? modellerIri(this.version);
  }

  /** The editing activity edits go into now, if one has started. */
  get currentActivity(): string | undefined {
    return this.activity;
  }

  /** The activity ends: the model was saved, or another opened. The next edit starts another. */
  endActivity(): void {
    this.activity = undefined;
  }

  /** Stamp what `diff`, a local edit, changed. Called inside the edit, so the stamps are part of it. */
  stamp(diff: RdfDiff): void {
    const modelIri = this.options.modelIri();
    const namespace = this.options.namespace();
    if (!modelIri || !namespace) return;
    const removed = new N3Store(diff.removed as never);
    const concepts = new Set<string>();
    const created = new Set<string>();
    const setByHand = new Set<string>();
    const formerActivities = new Set<string>();
    const resolved = new Map<string, string | null>();

    for (const q of diff.removed) if (q.predicate.value === P.wasGeneratedBy) formerActivities.add(q.object.value);
    for (const q of [...diff.added, ...diff.removed]) {
      if (q.graph.termType !== 'DefaultGraph') continue;
      if (STAMPS.has(q.predicate.value)) continue;
      if (this.isProvenanceNode(q.subject, removed)) continue;
      const concept = this.ownerOf(q.subject, removed, resolved);
      if (concept) concepts.add(concept);
    }
    for (const q of diff.added) {
      if (q.predicate.value === IRI.dctermsModified) setByHand.add(q.subject.value);
      if (q.predicate.value === IRI.inModel && q.object.value === modelIri) created.add(q.subject.value);
    }
    if (concepts.size === 0) return;
    // Only what is in the model after the edit: a deleted concept took its stamps with it. The model changed
    // whatever did.
    const stamped = [...concepts].filter((c) => c === modelIri || this.has(nn(c), IRI.inModel));
    if (!stamped.includes(modelIri) && this.has(nn(modelIri), IRI.rdfType)) stamped.push(modelIri);
    if (stamped.length === 0) return;

    const when = dateTimeLiteral(this.now()) as unknown as Term;
    const activity = this.activityIn(namespace, when);
    const add: Quad[] = [];
    const remove: Quad[] = [];
    const replace = (subject: string, predicate: string, object: Term) => {
      remove.push(...this.get(nn(subject), predicate));
      add.push(quad(nn(subject), nn(predicate), object as never) as unknown as Quad);
    };

    for (const concept of stamped) {
      if (!setByHand.has(concept)) replace(concept, IRI.dctermsModified, when);
      if (created.has(concept) && !this.has(nn(concept), IRI.dctermsCreated)) {
        add.push(quad(nn(concept), nn(IRI.dctermsCreated), when as never) as unknown as Quad);
      }
      for (const q of this.get(nn(concept), P.wasGeneratedBy)) formerActivities.add(q.object.value);
      replace(concept, P.wasGeneratedBy, nn(activity));
      replace(concept, P.generatedAtTime, when);
    }
    replace(activity, P.endedAtTime, when);
    this.write(remove, add);
    formerActivities.delete(activity);
    this.dropUnnamed(formerActivities, namespace);
  }

  /** The activity edits go into, started now — with la-gram and the user — when none is going. */
  private activityIn(namespace: string, when: Term): string {
    // The one going, while it is in this model: another model opened since starts another.
    if (this.activity?.startsWith(`${namespace}provenance/`) && this.has(nn(this.activity), IRI.rdfType)) return this.activity;
    const activity = `${namespace}provenance/edit-${this.uuid()}`;
    const t = (s: string, p: string, o: Term) => quad(nn(s), nn(p), o as never) as unknown as Quad;
    const remove: Quad[] = [];
    const add: Quad[] = [
      t(activity, IRI.rdfType, nn(P.activity)),
      t(activity, P.startedAtTime, when),
      t(activity, P.wasAssociatedWith, nn(this.agent)),
    ];
    if (!this.has(nn(this.agent), IRI.rdfType)) {
      add.push(
        t(this.agent, IRI.rdfType, nn(P.softwareAgent)),
        t(this.agent, IRI.rdfType, nn(P.softwareApplication)),
        t(this.agent, P.name, literal(this.options.software?.name ?? 'la-gram') as unknown as Term),
        ...(this.version ? [t(this.agent, P.softwareVersion, literal(this.version) as unknown as Term)] : []),
      );
    }
    const editor = this.options.editor();
    const key = editorKey(editor);
    if (key) {
      const user = `${namespace}provenance/user-${keyDigest(key)}`;
      const name = editor?.name?.trim();
      const email = editor?.email?.trim();
      const account = editor?.account;
      add.push(t(activity, P.wasAssociatedWith, nn(user)), t(user, IRI.rdfType, nn(P.person)));
      // What is known of the user now replaces what was: a name corrected, an address or an account added.
      for (const p of [P.name, P.email, P.sameAs, P.alternateName]) remove.push(...this.get(nn(user), p));
      if (name) add.push(t(user, P.name, literal(name) as unknown as Term));
      if (email) add.push(t(user, P.email, literal(email) as unknown as Term));
      if (account?.url) add.push(t(user, P.sameAs, nn(account.url)));
      if (account?.username) add.push(t(user, P.alternateName, literal(account.username) as unknown as Term));
    }
    this.write(remove, add);
    this.activity = activity;
    return activity;
  }

  /**
   * Remove la-gram's activities among `activities` that no concept names any more, and then the users and
   * the la-gram versions no activity names. A converter's run and agent are not la-gram's to remove.
   */
  private dropUnnamed(activities: Set<string>, namespace: string): void {
    const own = (iri: string) => iri.startsWith(`${namespace}provenance/`) || (this.options.software ? iri === this.agent : iri.startsWith(LA_GRAM_HOME));
    const agents = new Set<string>();
    const remove: Quad[] = [];
    for (const activity of activities) {
      if (!own(activity) || this.get(null, P.wasGeneratedBy, nn(activity)).length > 0) continue;
      const quads = this.get(nn(activity));
      for (const q of quads) if (q.predicate.value === P.wasAssociatedWith) agents.add(q.object.value);
      remove.push(...quads);
    }
    if (remove.length === 0) return;
    this.store.removeQuads(remove);
    const unnamed = [...agents].filter((a) => own(a) && this.get(null, P.wasAssociatedWith, nn(a)).length === 0);
    const agentQuads = unnamed.flatMap((a) => this.get(nn(a)));
    if (agentQuads.length > 0) this.store.removeQuads(agentQuads);
  }

  /**
   * The concept a changed statement is about: the subject itself when it is the model or a member of it
   * (`arch:inModel`); the view of a shape (`arch-vis:view`); else what it is a part of — a style, a route's
   * cell, a name, a picture — by the link that leads to it, up to a concept or a shape. Before or after the
   * edit: a removed statement is read from what the edit removed.
   */
  private ownerOf(subject: Quad['subject'], removed: N3Store, resolved: Map<string, string | null>): string | undefined {
    const seen = new Set<string>();
    const walk = (term: Quad['subject']): string | undefined => {
      const key = term.value;
      if (resolved.has(key)) return resolved.get(key) ?? undefined;
      if (seen.has(key) || seen.size > 256) return undefined;
      seen.add(key);
      const either = (p: string, o: Term | null = null) => [
        ...this.get(term as NamedNode, p, o),
        ...(removed.getQuads(term as never, nn(p) as never, o as never, null) as unknown as Quad[]),
      ];
      let owner: string | undefined;
      if (either(IRI.inModel).length > 0 || either(IRI.rdfType, nn(IRI.Model)).length > 0) owner = key;
      else {
        const view = either(NAMESPACES['arch-vis'] + 'view')[0];
        if (view) owner = view.object.value;
        else {
          const incoming = [
            ...this.get(null, null, term as Term),
            ...(removed.getQuads(null, null, term as never, null) as unknown as Quad[]),
          ];
          for (const link of incoming) {
            if (link.subject.value === key || NOT_PART_OF.has(link.predicate.value)) continue;
            owner = walk(link.subject);
            if (owner) break;
          }
        }
      }
      resolved.set(key, owner ?? null);
      return owner;
    };
    return walk(subject);
  }

  /** Whether `subject` is provenance itself — an activity, an agent: its own statements are not an edit. */
  private isProvenanceNode(subject: Quad['subject'], removed: N3Store): boolean {
    const types = [
      ...this.get(subject as NamedNode, IRI.rdfType),
      ...(removed.getQuads(subject as never, nn(IRI.rdfType) as never, null, null) as unknown as Quad[]),
    ];
    return types.some((q) => q.object.value.startsWith(PROV));
  }

  private has(subject: NamedNode, predicate: string): boolean {
    return this.get(subject, predicate).length > 0;
  }

  /** The model's statements matching a pattern — the default graph, which the store reads from its copy. */
  private get(subject: NamedNode | null, predicate?: string | null, object?: Term | null): Quad[] {
    return this.store.getQuads(subject, predicate ? nn(predicate) : null, (object ?? null) as NamedNode | null, MODEL);
  }

  private write(remove: Quad[], add: Quad[]): void {
    const keys = new Set(add.map(key));
    const stale = remove.filter((q) => !keys.has(key(q)));
    const fresh = add.filter((q) => !remove.some((r) => key(r) === key(q)));
    if (stale.length > 0) this.store.removeQuads(stale);
    if (fresh.length > 0) this.store.addQuads(fresh);
  }
}

function key(q: Quad): string {
  return `${q.subject.value} ${q.predicate.value} ${q.object.termType}:${q.object.value}`;
}

/** What the panel shows of a concept's provenance, read-only (Req 9.16). */
export interface ConceptProvenance {
  /** The last edit: when, by whom — and their account's page — with which tool, from the activity that generated it. */
  changed?: { at: string; by?: string; account?: string; tool?: string };
  /** Its other PROV statements — a converter's `prov:wasDerivedFrom` its source — as predicate and value. */
  other: Array<{ predicate: string; value: string }>;
}

/** A concept's provenance as the model records it: its last edit, and its other PROV statements. */
export function provenanceOf(store: RdfStore, iri: string): ConceptProvenance {
  const get = (s: string, p: string) => store.getQuads(nn(s), nn(p), null, MODEL);
  const first = (s: string, p: string) => get(s, p)[0]?.object.value;
  const statements = store.getQuads(nn(iri), null, null, MODEL).filter((q) => q.predicate.value.startsWith(PROV));
  const other = statements
    .filter((q) => q.predicate.value !== P.wasGeneratedBy && q.predicate.value !== P.generatedAtTime)
    .map((q) => ({ predicate: q.predicate.value, value: q.object.value }));
  const activity = first(iri, P.wasGeneratedBy);
  const at = first(iri, P.generatedAtTime) ?? (activity ? first(activity, P.endedAtTime) : undefined);
  if (!activity || !at) return { other };
  let by: string | undefined;
  let account: string | undefined;
  let tool: string | undefined;
  for (const agent of get(activity, P.wasAssociatedWith).map((q) => q.object.value)) {
    const types = get(agent, IRI.rdfType).map((q) => q.object.value);
    const name = first(agent, P.name);
    if (types.includes(P.softwareAgent)) {
      const version = first(agent, P.softwareVersion);
      tool = [name ?? agent, version].filter(Boolean).join(' ');
    } else if (types.includes(P.person)) {
      by = name ?? first(agent, P.alternateName) ?? first(agent, P.email);
      account = first(agent, P.sameAs);
    }
  }
  return { changed: { at, ...(by ? { by } : {}), ...(account ? { account } : {}), ...(tool ? { tool } : {}) }, other };
}
