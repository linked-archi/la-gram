# Requirements Document

## Introduction

This document specifies the requirements for the RDF Architecture Modeler — a web-based and desktop-installable tool for creating, managing, modifying, and visualizing architecture models. The tool is RDF-native: it reads architecture metamodels expressed as RDF/TTL ontologies and SHACL shapes (such as the Linked.Archi meta ontologies), dynamically generates modeling palettes from those metamodels, persists all architecture models as RDF (Turtle), and uses SPARQL graph queries for data retrieval and UI generation. The tool supports both browser-based and Electron-style desktop deployment.

## Glossary

- **Modeler**: The RDF Architecture Modeler application described in this document
- **Metamodel**: An OWL ontology (RDF/TTL) that defines the modeling language — its element types, relationship types, viewpoints, and constraints — conforming to the Linked.Archi `arch:Metamodel` class
- **SHACL_Shape**: A SHACL shapes graph that defines validation constraints and structural rules for a metamodel, used to enforce modeling rules and to derive UI affordances
- **Architecture_Model**: A user-created model conforming to a loaded Metamodel, persisted as RDF (Turtle), containing instances of `arch:Element`, `arch:Relationship`, and `arch:View`
- **Element**: An instance of `arch:Element` (or a metamodel-specific subclass) representing a node in an architecture model
- **Relationship**: An instance of `arch:Relationship` used as a predicate between Elements, or a `arch:QualifiedRelationship` when reification is needed
- **View**: An instance of `arch:View` (Diagram, Catalog, or Matrix) that exposes a subset of model concepts from a specific viewpoint
- **Palette**: A dynamically generated UI panel listing the Element types and Relationship types available for modeling, derived from the loaded Metamodel
- **RDF_Store**: The in-memory or persistent RDF triple store used by the Modeler to hold metamodels and architecture models
- **SPARQL_Engine**: The query engine that executes SPARQL queries against the RDF_Store
- **TTL_Parser**: The component that parses Turtle (TTL) syntax into RDF triples
- **TTL_Serializer**: The component that serializes RDF triples back into Turtle (TTL) syntax
- **Canvas**: The interactive diagramming surface where users place Elements and draw Relationships
- **Viewpoint**: A specification of conventions for a particular kind of architecture view, defining which element and relationship types are permitted
- **Architect**: The human user of the Modeler who creates and manages architecture models

## Requirements

### Requirement 1: Load and Parse Metamodel Ontologies

**User Story:** As an Architect, I want to load RDF/TTL ontology files and SHACL shapes as metamodels, so that the Modeler understands the modeling language I work with.

#### Acceptance Criteria

1. WHEN an Architect provides one or more TTL files containing an `arch:Metamodel` ontology, THE TTL_Parser SHALL parse the files into RDF triples and load the triples into the RDF_Store
2. WHEN an Architect provides SHACL shape files associated with a Metamodel, THE TTL_Parser SHALL parse the SHACL shapes and load the resulting triples into the RDF_Store
3. IF a TTL file contains syntax errors, THEN THE TTL_Parser SHALL return a descriptive error message indicating the line number and nature of the syntax error
4. IF a loaded ontology references imports (via `owl:imports`) that are not yet in the RDF_Store, THEN THE Modeler SHALL attempt to resolve and load the imported ontologies
5. WHEN a Metamodel is successfully loaded, THE Modeler SHALL display the Metamodel name, version, and description extracted from the ontology metadata

### Requirement 2: Dynamic Palette Generation from Metamodel

**User Story:** As an Architect, I want the tool to automatically generate a palette of available elements and relationships from the loaded metamodel, so that I can model using the correct vocabulary without manual configuration.

#### Acceptance Criteria

1. WHEN a Metamodel is loaded into the RDF_Store, THE Modeler SHALL execute SPARQL queries to discover all concrete subclasses of `arch:Element` defined in the Metamodel
2. WHEN a Metamodel is loaded into the RDF_Store, THE Modeler SHALL execute SPARQL queries to discover all instances of `arch:Relationship` (relationship properties) defined in the Metamodel
3. THE Palette SHALL group discovered Element types by their metamodel-defined layer or category (e.g., Business, Application, Technology for ArchiMate)
4. THE Palette SHALL display each Element type with its `skos:prefLabel` and its preferred visual notation icon referenced via `arch:prefVisNotation`
5. THE Palette SHALL display each Relationship type with its `skos:prefLabel` and visual notation
6. WHEN a Viewpoint is selected, THE Palette SHALL filter the displayed Element and Relationship types to only those permitted by the Viewpoint definition
7. IF the Metamodel defines abstract element types (via `arch:isAbstract` set to true), THEN THE Palette SHALL exclude abstract types from the available modeling elements, but only diplay them in the palette for classification or grouping if the definition is a parent class

### Requirement 3: RDF-Native Model Persistence

**User Story:** As an Architect, I want my architecture models to be stored as RDF in Turtle format, so that the models are interoperable with other RDF tools and queryable via SPARQL.

#### Acceptance Criteria

1. THE Modeler SHALL persist each Architecture_Model as one or more Turtle (TTL) files
2. WHEN an Architect saves a model, THE TTL_Serializer SHALL serialize all model triples (Elements, Relationships, Views, and their properties) into valid Turtle syntax
3. WHEN an Architect opens a previously saved TTL model file, THE TTL_Parser SHALL parse the file and load the model into the RDF_Store
4. FOR ALL valid Architecture_Model instances, parsing a serialized TTL file and then serializing and parsing again SHALL produce an equivalent RDF graph (round-trip property)
5. THE Modeler SHALL preserve namespace prefixes defined in the original TTL files across save and load cycles
6. WHEN an Architect creates a new model, THE Modeler SHALL generate a model resource typed as `arch:Model` with a `arch:conformsToMetamodel` link to the active Metamodel

### Requirement 4: Create and Edit Architecture Elements

**User Story:** As an Architect, I want to create, modify, and delete architecture elements on a diagram canvas, so that I can build and evolve my architecture models visually.

#### Acceptance Criteria

1. WHEN an Architect drags an Element type from the Palette onto the Canvas, THE Modeler SHALL create a new RDF resource of that Element type in the RDF_Store and render the Element on the Canvas
2. WHEN an Architect selects an Element on the Canvas, THE Modeler SHALL display a property panel showing the Element's RDF properties (label, definition, custom properties) for editing
3. WHEN an Architect modifies an Element property in the property panel, THE Modeler SHALL update the corresponding RDF triple in the RDF_Store
4. WHEN an Architect deletes an Element from the Canvas, THE Modeler SHALL remove the Element resource and all associated Relationship triples from the RDF_Store
5. THE Modeler SHALL assign each new Element a unique IRI within the model's namespace
6. WHEN an Architect moves or resizes an Element on the Canvas, THE Modeler SHALL update the diagram layout properties in the RDF_Store using the `arch-vis` visualization ontology

### Requirement 5: Create and Edit Relationships

**User Story:** As an Architect, I want to draw relationships between elements using the relationship types defined in the metamodel, so that I can express the connections in my architecture.

#### Acceptance Criteria

1. WHEN an Architect initiates a relationship from a source Element to a target Element on the Canvas, THE Modeler SHALL present only the Relationship types that are valid between the source and target Element types according to `arch:domainIncludes` and `arch:rangeIncludes` constraints
2. WHEN an Architect selects a Relationship type and confirms the connection, THE Modeler SHALL create the corresponding RDF triple (or QualifiedRelationship resource) in the RDF_Store
3. WHEN a Relationship requires reification (multiple relationships of the same type between the same elements, or metadata on the relationship), THE Modeler SHALL create an `arch:QualifiedRelationship` instance with `arch:relSource`, `arch:relTarget`, and `arch:relPredicate` properties
4. WHEN an Architect deletes a Relationship from the Canvas, THE Modeler SHALL remove the corresponding triple or QualifiedRelationship resource from the RDF_Store
5. IF an Architect attempts to create a Relationship that violates SHACL constraints, THEN THE Modeler SHALL display a validation warning describing the constraint violation

### Requirement 6: SPARQL Query Execution and UI Generation

**User Story:** As an Architect, I want to execute SPARQL queries against my architecture models and have the results drive UI visualizations, so that I can analyze and explore my models using graph queries.

#### Acceptance Criteria

1. THE SPARQL_Engine SHALL support SPARQL 1.1 SELECT, CONSTRUCT, ASK, and DESCRIBE query forms against the RDF_Store
2. WHEN an Architect submits a SPARQL query, THE SPARQL_Engine SHALL execute the query and return results within 2 seconds for models containing up to 10,000 triples
3. WHEN a SPARQL CONSTRUCT query returns a subgraph, THE Modeler SHALL offer to render the resulting subgraph as a new diagram View on the Canvas
4. THE Modeler SHALL provide a SPARQL query editor with syntax highlighting and auto-completion for prefixes and vocabulary terms from the loaded Metamodel
5. IF a SPARQL query contains syntax errors, THEN THE SPARQL_Engine SHALL return a descriptive error message indicating the nature of the syntax error

### Requirement 7: Architecture View Management

**User Story:** As an Architect, I want to create and manage multiple views (diagrams, catalogs, matrices) of my architecture model, so that I can address different stakeholder concerns.

#### Acceptance Criteria

1. WHEN an Architect creates a new View, THE Modeler SHALL create an `arch:View` resource in the RDF_Store and allow the Architect to select a Viewpoint
2. WHEN a Viewpoint is assigned to a View, THE Modeler SHALL constrain the Palette and validation rules to the Element and Relationship types permitted by that Viewpoint
3. THE Modeler SHALL support creating Diagram views (graphical node-and-edge layouts on the Canvas)
4. THE Modeler SHALL support creating Catalog views (tabular listings of Elements filtered by type)
5. THE Modeler SHALL support creating Matrix views (grid showing Relationships between two sets of Element types)
6. WHEN an Element appears in multiple Views, THE Modeler SHALL maintain a single underlying RDF resource for that Element across all Views
7. WHEN an Architect modifies an Element's properties in one View, THE Modeler SHALL reflect the change in all other Views containing that Element

### Requirement 8: SHACL Validation

**User Story:** As an Architect, I want the tool to validate my models against the SHACL shapes defined in the metamodel, so that I can ensure my models conform to the modeling rules.

#### Acceptance Criteria

1. WHEN an Architect triggers validation, THE Modeler SHALL execute SHACL validation of the Architecture_Model against the loaded SHACL_Shape graphs
2. WHEN SHACL validation produces constraint violations, THE Modeler SHALL display each violation with the focus node, the violated shape, and a human-readable message
3. THE Modeler SHALL visually highlight Elements and Relationships on the Canvas that have SHACL validation violations
4. WHILE an Architect is editing a model, THE Modeler SHALL perform incremental SHACL validation on modified resources and display violations within 1 second of the edit

### Requirement 9: TTL Serialization and Pretty Printing

**User Story:** As an Architect, I want the serialized TTL output to be human-readable and well-formatted, so that I can review and version-control my model files.

#### Acceptance Criteria

1. THE TTL_Serializer SHALL format output Turtle files with consistent indentation, namespace prefix declarations at the top, and logical grouping of triples by subject
2. THE TTL_Serializer SHALL use the shortest available prefix for IRIs based on the declared namespace prefixes
3. THE TTL_Serializer SHALL produce syntactically valid Turtle that conforms to the W3C RDF 1.1 Turtle specification
4. FOR ALL valid Architecture_Model instances, parsing then pretty-printing then parsing SHALL produce an equivalent RDF graph (round-trip property)

### Requirement 10: Web and Desktop Deployment

**User Story:** As an Architect, I want to use the tool both in a web browser and as an installable desktop application, so that I can work in my preferred environment.

#### Acceptance Criteria

1. THE Modeler SHALL run as a web application accessible via modern web browsers (Chrome, Firefox, Edge, Safari)
2. THE Modeler SHALL be packaged as an installable desktop application using Electron (or equivalent framework) for Windows, macOS, and Linux
3. WHILE running as a desktop application, THE Modeler SHALL provide native file system access for opening and saving TTL model files
4. WHILE running as a web application, THE Modeler SHALL support file upload and download for TTL model files
5. THE Modeler SHALL provide identical core modeling functionality in both web and desktop deployment modes

### Requirement 11: Model Navigation and Explorer

**User Story:** As an Architect, I want a tree-based explorer panel to navigate the structure of my model, so that I can quickly find and select elements, relationships, and views.

#### Acceptance Criteria

1. THE Modeler SHALL display a model explorer panel showing a hierarchical tree of the Architecture_Model contents organized by `arch:Folder` structure
2. WHEN an Architect selects an item in the model explorer, THE Modeler SHALL highlight the corresponding Element or View on the Canvas
3. WHEN an Architect creates or deletes a model element, THE model explorer SHALL update to reflect the change
4. THE model explorer SHALL support filtering elements by type, name, or custom property values

### Requirement 12: Import and Export

**User Story:** As an Architect, I want to import existing architecture models and export my models in standard formats, so that I can integrate with other architecture tools.

#### Acceptance Criteria

1. WHEN an Architect imports an ArchiMate Open Exchange Format (XML) file, THE Modeler SHALL convert the imported data into RDF triples conforming to the ArchiMate metamodel and load the triples into the RDF_Store
2. WHEN an Architect exports a model, THE TTL_Serializer SHALL produce a valid Turtle file containing all model triples
3. THE Modeler SHALL support exporting diagram Views as SVG or PNG images
4. IF an imported file contains elements or relationships not defined in the loaded Metamodel, THEN THE Modeler SHALL report the unrecognized types and allow the Architect to map or skip the elements
