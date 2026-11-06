/**
 * A model file read as la-gram reads it, for la-gram-git: opened in an App of
 * its own — its declared metamodels loaded from the copies bundled with the
 * tool, retired vocabulary migrated, as File › Open does — so that what the
 * tool says of a file is what the editor would. A fresh App for each file: what
 * one file loads cannot change what another is checked against.
 *
 * "As la-gram writes it" is the file's triples written as Save writes them —
 * order, prefixes, layout of the text — and nothing more: what opening a file
 * adds (a default view, a layout for elements no view shows, retired
 * vocabulary migrated) is not a matter of how it is written, so `check` does
 * not ask for it and `fix` does not add it.
 */
import { basename } from 'node:path';
import { DataFactory } from 'n3';
import type { NamedNode } from '@rdfjs/types';
import { createApp, type App } from '../app.js';
import type { ValidationResult } from '../rdf-engine/interfaces.js';
import { shapeIriOf } from '../rdf-engine/finding-shape.js';
import { NAMESPACES } from '../rdf-engine/namespaces.js';
import { MODEL_FORMATS, formatOfPath, parseModelText } from '../import-export/model-io.js';
import { detectFormat } from '../metamodel-manager/asset-sources.js';
import { hasLabel, labelOf } from '../model-manager/model-queries.js';
import { fieldName } from '../model-manager/field-names.js';
import type { DiffWords } from '../model-manager/model-diff-text.js';

/** A shapes file given with `--shapes`. */
export interface ShapesFile {
  name: string;
  text: string;
}

/** A model file, opened. */
export interface OpenModel {
  app: App;
  modelIri: string;
  /** Declared metamodels the tool does not have: validated without them. */
  missingMetamodels: string[];
}

/** The extensions la-gram saves models with. */
export const MODEL_EXTENSIONS: readonly string[] = MODEL_FORMATS.map((f) => `.${f.extension}`);

/** Whether a path has a model file's extension. */
export function hasModelExtension(path: string): boolean {
  return formatOfPath(path) !== undefined;
}

/** Whether the text is a la-gram model: RDF with an `arch:Model` in it. Throws when it does not parse. */
export function isModel(text: string, path: string): boolean {
  const model = NAMESPACES.arch + 'Model';
  return parseModelText(text, detectFormat(null, path)).some(
    (q) => q.predicate.value === NAMESPACES.rdf + 'type' && q.object.value === model,
  );
}

/** Open a model file as la-gram does, with any extra shapes. */
export async function openModel(text: string, path: string, shapes: readonly ShapesFile[] = []): Promise<OpenModel> {
  const app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9, validation: 'inline' });
  const opened = await app.openModel(text, basename(path));
  for (const file of shapes) await app.loadAssetFile(file.text, file.name);
  const modelIri = app.session.modelIri;
  if (!modelIri) throw new Error('No model in it.');
  return { app, modelIri, missingMetamodels: opened.missingMetamodels };
}

/** The model validated now, as the Validation tab has it. */
export function findingsOf(app: App): ValidationResult[] {
  let results: ValidationResult[] = [];
  const take = (e: { detail?: unknown }) => {
    results = (e.detail as { results: ValidationResult[] }).results;
  };
  app.components.eventBus.on('validation-updated', take);
  try {
    app.runValidation();
  } finally {
    app.components.eventBus.off('validation-updated', take);
  }
  return results;
}

/**
 * A model file's triples as la-gram writes them to `path` (its extension
 * decides the format) — read from `text` as a file named `readAs` is (`path`
 * when absent): the triples only, with the prefixes of the metamodels it
 * declares.
 */
export async function asLaGramWrites(text: string, path: string, readAs = path): Promise<string> {
  const format = formatOfPath(path);
  if (!format) throw new Error(`${path} is not a model file la-gram writes.`);
  const app = await createApp({ assetMode: 'offline', validationDelayMs: 1e9, validation: 'inline' });
  app.modelIO.load(text, basename(readAs));
  const quads = app.components.store.getQuads(null, null, null, DataFactory.defaultGraph() as never);
  const model = quads.find((q) => q.predicate.value === NAMESPACES.rdf + 'type' && q.object.value === NAMESPACES.arch + 'Model');
  if (!model) throw new Error('No model in it.');
  const declared = quads
    .filter((q) => q.subject.equals(model.subject) && q.predicate.value === NAMESPACES.arch + 'modelConformsToMetamodel')
    .map((q) => q.object.value);
  for (const iri of declared) {
    if (app.loadedMetamodels().some((m) => m.metamodelIri === iri)) continue;
    await app.loadMetamodel(iri).catch(() => undefined);
  }
  return app.modelIO.serialize(model.subject.value, { format });
}

/** Types and properties named as the editor names them. */
export function wordsOf(app: App): DiffWords {
  const store = app.components.store;
  return {
    typeName: (iri) => labelOf(store, iri),
    propertyName: (iri) => fieldName(iri, undefined, (p) => (hasLabel(store, p) ? labelOf(store, p) : undefined)),
  };
}

/** A concept in words: `Billing (Application Component)`. */
export function describe(app: App, iri: string): string {
  const store = app.components.store;
  const types = store.getQuads({ termType: 'NamedNode', value: iri } as NamedNode, { termType: 'NamedNode', value: NAMESPACES.rdf + 'type' } as NamedNode, null);
  const type = types.find((q) => !q.object.value.startsWith(NAMESPACES.arch)) ?? types[0];
  const name = hasLabel(store, iri) ? labelOf(store, iri) : iri;
  return type ? `${name} (${labelOf(store, type.object.value)})` : name;
}

/** Whether a finding comes from a shape's SPARQL-based constraint (advisory in CI, for now). */
export function byRules(result: ValidationResult): boolean {
  return result.sourceConstraintComponent?.value === NAMESPACES.sh + 'SPARQLConstraintComponent';
}

/** Whether a finding is a reference to what the model does not have. */
export function isMissingReference(result: ValidationResult): boolean {
  return result.sourceShape.value === '';
}

/**
 * A key for a finding, the same in two versions of a file: its node, path,
 * constraint and message — and its shape by IRI: a shape written inline is a
 * blank node, whose label is new each time the shapes are read, so it is told
 * by the named shape it is written in.
 */
export function findingKey(result: ValidationResult): string {
  const shape = shapeIriOf(result) ?? '';
  return [result.focusNode.value, result.resultPath.value, shape, result.sourceConstraintComponent?.value ?? '', result.message].join('\u0000');
}
